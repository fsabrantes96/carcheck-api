import { ApiProperty } from '@nestjs/swagger';
import {
    FuelType,
    ListingStatus,
    Transmission,
} from '../../generated/prisma/client.js';

type ListingWithRelations = {
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

export class ListingResponseDto {
    @ApiProperty() id: string;
    @ApiProperty() sellerId: string;
    @ApiProperty() sellerName: string;
    @ApiProperty() title: string;
    @ApiProperty() description: string;
    @ApiProperty() priceCents: number;
    @ApiProperty() city: string;
    @ApiProperty() state: string;
    @ApiProperty({ enum: ListingStatus }) status: ListingStatus;
    @ApiProperty({ type: VehicleResponseDto, nullable: true })
    vehicle: VehicleResponseDto | null;
    @ApiProperty() createdAt: Date;

    static from(listing: ListingWithRelations): ListingResponseDto {
        const dto = new ListingResponseDto();
        dto.id = listing.id;
        dto.sellerId = listing.sellerId;
        dto.sellerName = listing.seller.name;
        dto.title = listing.title;
        dto.description = listing.description;
        dto.priceCents = listing.priceCents;
        dto.city = listing.city;
        dto.state = listing.state;
        dto.status = listing.status;
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