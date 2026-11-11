import {
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateListingDto } from './dto/create-listing.dto.js';
import { ListListingsQueryDto } from './dto/list-listings-query.dto.js';
import { ListingResponseDto } from './dto/listing-response.dto.js';
import { PaginatedListingsResponseDto } from './dto/paginated-listings-response.dto.js';
import { UpdateListingDto } from './dto/update-listing.dto.js';
import type { VehicleDto } from './dto/vehicle.dto.js';
import { decideListingTransition } from './listings.state-machine.js';
import type { ListingAction } from './listings.state-machine.js';

const include = { seller: true, vehicle: true } as const;

function toVehicleData(vehicle: VehicleDto) {
    return {
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        mileageKm: vehicle.mileageKm,
        fuel: vehicle.fuel,
        transmission: vehicle.transmission,
    };
}

@Injectable()
export class ListingsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(sellerId: string, dto: CreateListingDto): Promise<ListingResponseDto> {
        const listing = await this.prisma.listing.create({
            data: {
                title: dto.title,
                description: dto.description,
                priceCents: dto.priceCents,
                city: dto.city,
                state: dto.state,
                sellerId,
                vehicle: { create: toVehicleData(dto.vehicle) },
            },
            include,
        });
        return ListingResponseDto.from(listing);
    }

    async findAll(query: ListListingsQueryDto): Promise<PaginatedListingsResponseDto> {
        const { brand, city, state, minPriceCents, maxPriceCents, minYear, maxYear, page, limit } = query;

        const where: Prisma.ListingWhereInput = {
            status: 'ACTIVE',
            ...(city && { city: { equals: city, mode: 'insensitive' } }),
            ...(state && { state: state.toUpperCase() }),
            ...((minPriceCents !== undefined || maxPriceCents !== undefined) && {
                priceCents: { gte: minPriceCents, lte: maxPriceCents },
            }),
            ...((brand || minYear !== undefined || maxYear !== undefined) && {
                vehicle: {
                    is: {
                        ...(brand && { brand: { equals: brand, mode: 'insensitive' } }),
                        ...((minYear !== undefined || maxYear !== undefined) && {
                            year: { gte: minYear, lte: maxYear },
                        }),
                    },
                },
            }),
        };

        const [listings, total] = await this.prisma.$transaction([
            this.prisma.listing.findMany({
                where,
                include,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.listing.count({ where }),
        ]);

        return {
            items: listings.map((l) => ListingResponseDto.from(l)),
            total,
            page,
            limit,
        };
    }

    async findOnePublic(id: string): Promise<ListingResponseDto> {
        const listing = await this.prisma.listing.findFirst({
            where: { id, status: 'ACTIVE' },
            include,
        });
        if (!listing) throw new NotFoundException('Anúncio não encontrado');
        return ListingResponseDto.from(listing);
    }

    async findMine(sellerId: string): Promise<ListingResponseDto[]> {
        const listings = await this.prisma.listing.findMany({
            where: { sellerId, status: { not: 'ARCHIVED' } },
            include,
            orderBy: { createdAt: 'desc' },
        });
        return listings.map((l) => ListingResponseDto.from(l));
    }

    async update(
        id: string,
        userId: string,
        dto: UpdateListingDto,
    ): Promise<ListingResponseDto> {
        await this.assertOwner(id, userId);

        // Campos ausentes chegam como undefined, e o Prisma os ignora (update parcial).
        const listing = await this.prisma.listing.update({
            where: { id },
            data: {
                title: dto.title,
                description: dto.description,
                priceCents: dto.priceCents,
                city: dto.city,
                state: dto.state,
                status: dto.status,
                vehicle: dto.vehicle && { update: toVehicleData(dto.vehicle) },
            },
            include,
        });
        return ListingResponseDto.from(listing);
    }

    pause(id: string, userId: string): Promise<ListingResponseDto> {
        return this.transitionAndLoad(id, userId, 'PAUSE');
    }

    activate(id: string, userId: string): Promise<ListingResponseDto> {
        return this.transitionAndLoad(id, userId, 'ACTIVATE');
    }

    markSold(id: string, userId: string): Promise<ListingResponseDto> {
        return this.transitionAndLoad(id, userId, 'MARK_SOLD');
    }

    /** Arquiva o anúncio (status ARCHIVED) em vez de apagá-lo. */
    async remove(id: string, userId: string): Promise<void> {
        await this.transition(id, userId, 'ARCHIVE');
    }

    private async transitionAndLoad(
        id: string,
        userId: string,
        action: ListingAction,
    ): Promise<ListingResponseDto> {
        await this.transition(id, userId, action);
        const listing = await this.prisma.listing.findUniqueOrThrow({
            where: { id },
            include,
        });
        return ListingResponseDto.from(listing);
    }

    /**
     * Aplica uma transição de status: 404 se não existe, 403 se não é do
     * usuário, 409 se a ação não é permitida no status atual ou se outra
     * requisição mudou o status entre a leitura e a gravação.
     */
    private async transition(
        id: string,
        userId: string,
        action: ListingAction,
    ): Promise<void> {
        const listing = await this.prisma.listing.findUnique({
            where: { id },
            select: { sellerId: true, status: true },
        });
        if (!listing) throw new NotFoundException('Anúncio não encontrado');
        if (listing.sellerId !== userId) {
            throw new ForbiddenException('Este anúncio não pertence a você');
        }
        const decision = decideListingTransition(action, listing.status);
        if (!decision.ok) {
            throw new ConflictException('Ação não permitida no status atual do anúncio');
        }

        // Grava só se o status ainda for o que foi lido (proteção contra corrida).
        const { count } = await this.prisma.listing.updateMany({
            where: { id, sellerId: userId, status: listing.status },
            data: { status: decision.to },
        });
        if (count === 0) {
            throw new ConflictException('O anúncio mudou de status; recarregue e tente novamente');
        }
    }

    private async assertOwner(id: string, userId: string): Promise<void> {
        const listing = await this.prisma.listing.findUnique({
            where: { id },
            select: { sellerId: true },
        });
        if (!listing) throw new NotFoundException('Anúncio não encontrado');
        if (listing.sellerId !== userId) {
            throw new ForbiddenException('Este anúncio não pertence a você');
        }
    }
}