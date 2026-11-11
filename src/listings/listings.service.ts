import {
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import { CLOCK, SystemClock } from '../common/clock/clock.js';
import type { Clock } from '../common/clock/clock.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
    isPrismaError,
    PRISMA_RECORD_NOT_FOUND,
} from '../common/prisma/prisma-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateListingDto } from './dto/create-listing.dto.js';
import { ListListingsQueryDto } from './dto/list-listings-query.dto.js';
import { ListingResponseDto } from './dto/listing-response.dto.js';
import { MyListingResponseDto } from './dto/my-listing-response.dto.js';
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
    constructor(
        private readonly prisma: PrismaService,
        // Opcional com padrão: só carimba o endedAt dos agendamentos cancelados.
        @Optional() @Inject(CLOCK) private readonly clock: Clock = new SystemClock(),
    ) { }

    async create(sellerId: string, dto: CreateListingDto): Promise<MyListingResponseDto> {
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
        return MyListingResponseDto.from(listing);
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

    async findMine(sellerId: string): Promise<MyListingResponseDto[]> {
        const listings = await this.prisma.listing.findMany({
            where: { sellerId, status: { not: 'ARCHIVED' } },
            include,
            orderBy: { createdAt: 'desc' },
        });
        return listings.map((l) => MyListingResponseDto.from(l));
    }

    async update(
        id: string,
        userId: string,
        dto: UpdateListingDto,
    ): Promise<MyListingResponseDto> {
        await this.assertOwner(id, userId);

        try {
            // Campos ausentes chegam como undefined, e o Prisma os ignora (update parcial).
            // O filtro de status no where impede editar um anúncio arquivado,
            // mesmo que ele seja arquivado entre o assertOwner e esta gravação.
            const listing = await this.prisma.listing.update({
                where: { id, status: { not: 'ARCHIVED' } },
                data: {
                    title: dto.title,
                    description: dto.description,
                    priceCents: dto.priceCents,
                    city: dto.city,
                    state: dto.state,
                    vehicle: dto.vehicle && { update: toVehicleData(dto.vehicle) },
                },
                include,
            });
            return MyListingResponseDto.from(listing);
        } catch (error) {
            if (isPrismaError(error, PRISMA_RECORD_NOT_FOUND)) {
                // Consulta de apoio: só decide se o motivo foi o anúncio arquivado.
                // P2025 também pode vir do veículo aninhado; nesse caso o erro segue.
                const current = await this.prisma.listing.findUnique({
                    where: { id },
                    select: { status: true },
                });
                if (current?.status === 'ARCHIVED') {
                    throw new ConflictException('Anúncio arquivado não pode ser alterado');
                }
            }
            throw error;
        }
    }

    pause(id: string, userId: string): Promise<MyListingResponseDto> {
        return this.transitionAndLoad(id, userId, 'PAUSE');
    }

    activate(id: string, userId: string): Promise<MyListingResponseDto> {
        return this.transitionAndLoad(id, userId, 'ACTIVATE');
    }

    markSold(id: string, userId: string): Promise<MyListingResponseDto> {
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
    ): Promise<MyListingResponseDto> {
        await this.transition(id, userId, action);
        const listing = await this.prisma.listing.findUniqueOrThrow({
            where: { id },
            include,
        });
        return MyListingResponseDto.from(listing);
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

        const to = decision.to;
        await this.prisma.$transaction(async (tx) => {
            // 1) UPDATE do anúncio primeiro: pega o lock da linha, e uma criação de
            // agendamento concorrente (SELECT ... FOR SHARE) espera esta transação.
            // Grava só se o status ainda for o que foi lido (proteção contra corrida).
            const { count } = await tx.listing.updateMany({
                where: { id, sellerId: userId, status: listing.status },
                data: { status: to },
            });
            if (count === 0) {
                throw new ConflictException('O anúncio mudou de status; recarregue e tente novamente');
            }
            if (to === 'ACTIVE') return;

            // 2) Saindo de ACTIVE: com avaliação paga em andamento, não pode (rollback).
            const paid = await tx.appointment.findFirst({
                where: { listingId: id, status: 'PAID' },
                select: { id: true },
            });
            if (paid) {
                throw new ConflictException(
                    'O anúncio tem avaliação paga em andamento e não pode sair de ACTIVE',
                );
            }

            // 3) Cancela os agendamentos ainda não pagos do anúncio. Quem cancelou
            // foi o vendedor (ação dele), não o sistema: fica visível em endedBy.
            await tx.appointment.updateMany({
                where: { listingId: id, status: { in: ['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] } },
                data: { status: 'CANCELLED', endedBy: 'SELLER', endedAt: this.clock.now() },
            });
        });
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