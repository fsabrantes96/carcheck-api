import { ApiProperty } from '@nestjs/swagger';
import { ApiBrazilianState } from '../../common/validation/brazilian-state.js';
import { Specialty } from '../../generated/prisma/client.js';

export type InspectorWithUser = {
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

/** Perfil público do avaliador (GET /inspectors). Sem comissão nem repasse. */
export class InspectorResponseDto {
    @ApiProperty() id: string;
    @ApiProperty() name: string;
    @ApiProperty() bio: string;
    @ApiProperty({ enum: Specialty, isArray: true }) specialties: Specialty[];
    @ApiProperty() city: string;
    @ApiBrazilianState() state: string;
    @ApiProperty() serviceRadiusKm: number;
    @ApiProperty() basePriceCents: number;
    @ApiProperty() verified: boolean;

    static from(profile: InspectorWithUser): InspectorResponseDto {
        return InspectorResponseDto.fillPublicFields(new InspectorResponseDto(), profile);
    }

    /** Copia campo a campo os dados públicos para o DTO informado. */
    protected static fillPublicFields<T extends InspectorResponseDto>(
        dto: T,
        profile: InspectorWithUser,
    ): T {
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
