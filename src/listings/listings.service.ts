import {
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

const include = { seller: true, vehicle: true } as const;

@Injectable()
export class ListingsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(sellerId: string, dto: CreateListingDto): Promise<ListingResponseDto> {
        const { vehicle, ...data } = dto;
        const listing = await this.prisma.listing.create({
            data: { ...data, sellerId, vehicle: { create: { ...vehicle } } },
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
            where: { sellerId },
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

        const { vehicle, ...data } = dto;
        const listing = await this.prisma.listing.update({
            where: { id },
            data: { ...data, ...(vehicle && { vehicle: { update: { ...vehicle } } }) },
            include,
        });
        return ListingResponseDto.from(listing);
    }

    async remove(id: string, userId: string): Promise<void> {
        await this.assertOwner(id, userId);
        await this.prisma.listing.delete({ where: { id } });
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