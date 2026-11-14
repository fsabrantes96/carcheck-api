import { ApiProperty } from '@nestjs/swagger';
import { splitPlatformFee } from '../../common/money/platform-fee.js';
import { InspectorResponseDto } from './inspector-response.dto.js';
import type { InspectorWithUser } from './inspector-response.dto.js';

/**
 * Perfil do próprio avaliador (GET /inspectors/me): os campos públicos mais a
 * comissão atual da plataforma e o repasse estimado sobre o preço base. Só o
 * avaliador vê esses valores; a lista pública não os traz.
 */
export class MyInspectorProfileResponseDto extends InspectorResponseDto {
    @ApiProperty({ type: 'integer', example: 1000, description: 'Comissão atual da plataforma em pontos-base (1000 = 10%)' })
    platformFeeBps: number;

    @ApiProperty({ type: 'integer', example: 13500, description: 'Repasse estimado em centavos sobre o preço base, com a comissão atual' })
    estimatedPayoutCents: number;

    static fromOwnProfile(
        profile: InspectorWithUser,
        platformFeeBps: number,
    ): MyInspectorProfileResponseDto {
        const dto = InspectorResponseDto.fillPublicFields(new MyInspectorProfileResponseDto(), profile);
        dto.platformFeeBps = platformFeeBps;
        dto.estimatedPayoutCents = splitPlatformFee(profile.basePriceCents, platformFeeBps).inspectorPayoutCents;
        return dto;
    }
}
