import { ApiProperty } from '@nestjs/swagger';
import {
    FuelType,
    ListingStatus,
    Transmission,
} from '../../generated/prisma/client.js';

export type ListingWithRelations = {
    id: string;
    sellerId: string;
    title: string;
    description: string;
    priceCents: number;
    city: string;
    state: string;
    status: ListingStatus;
    createdAt: Date;
    seller: { name: string };
    vehicle: {
        brand: string;
        model: string;
        year: number;
        mileageKm: number;
        fuel: FuelType;
        transmission: Transmission;
    } | null;
};

export class VehicleResponseDto {
    @ApiProperty() brand: string;
    @ApiProperty() model: string;
    @ApiProperty() year: number;
    @ApiProperty() mileageKm: number;
    @ApiProperty({ enum: FuelType }) fuel: FuelType;
    @ApiProperty({ enum: Transmission }) transmission: Transmission;
}

/**
 * Resposta pública do anúncio (GET /listings, GET /listings/:id). Não traz
 * sellerId nem status: a lista pública só mostra anúncios ACTIVE, e ids de
 * usuário não saem em respostas públicas. As rotas do dono usam
 * MyListingResponseDto.
 */
export class ListingResponseDto {
    @ApiProperty() id: string;
    @ApiProperty() sellerName: string;
    @ApiProperty() title: string;
    @ApiProperty() description: string;
    @ApiProperty() priceCents: number;
    @ApiProperty() city: string;
    @ApiProperty() state: string;
    @ApiProperty({ type: VehicleResponseDto, nullable: true })
    vehicle: VehicleResponseDto | null;
    @ApiProperty() createdAt: Date;

    static from(listing: ListingWithRelations): ListingResponseDto {
        return ListingResponseDto.fillPublicFields(new ListingResponseDto(), listing);
    }

    /** Copia campo a campo os dados públicos para o DTO informado. */
    protected static fillPublicFields<T extends ListingResponseDto>(
        dto: T,
        listing: ListingWithRelations,
    ): T {
        dto.id = listing.id;
        dto.sellerName = listing.seller.name;
        dto.title = listing.title;
        dto.description = listing.description;
        dto.priceCents = listing.priceCents;
        dto.city = listing.city;
        dto.state = listing.state;
        dto.createdAt = listing.createdAt;
        dto.vehicle = listing.vehicle
            ? {
                brand: listing.vehicle.brand,
                model: listing.vehicle.model,
                year: listing.vehicle.year,
                mileageKm: listing.vehicle.mileageKm,
                fuel: listing.vehicle.fuel,
                transmission: listing.vehicle.transmission,
            }
            : null;
        return dto;
    }
}
