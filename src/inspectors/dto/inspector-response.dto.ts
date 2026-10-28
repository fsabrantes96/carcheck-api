import { ApiProperty } from '@nestjs/swagger';
import { Specialty } from '../../generated/prisma/client.js';

type InspectorWithUser = {
    id: string;
    bio: string;
    specialties: Specialty[];
    city: string;
    state: string;
    serviceRadiusKm: number;
    basePriceCents: number;
    verified: boolean;
    user: { name: string };
};

export class InspectorResponseDto {
    @ApiProperty() id: string;
    @ApiProperty() name: string;
    @ApiProperty() bio: string;
    @ApiProperty({ enum: Specialty, isArray: true }) specialties: Specialty[];
    @ApiProperty() city: string;
    @ApiProperty() state: string;
    @ApiProperty() serviceRadiusKm: number;
    @ApiProperty() basePriceCents: number;
    @ApiProperty() verified: boolean;

    static from(profile: InspectorWithUser): InspectorResponseDto {
        const dto = new InspectorResponseDto();
        dto.id = profile.id;
        dto.name = profile.user.name;
        dto.bio = profile.bio;
        dto.specialties = profile.specialties;
        dto.city = profile.city;
        dto.state = profile.state;
        dto.serviceRadiusKm = profile.serviceRadiusKm;
        dto.basePriceCents = profile.basePriceCents;
        dto.verified = profile.verified;
        return dto;
    }
}