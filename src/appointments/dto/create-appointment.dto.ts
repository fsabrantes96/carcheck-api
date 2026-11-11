import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsUUID, Matches } from 'class-validator';

/**
 * Pedido de avaliação. O cliente só escolhe o anúncio, o avaliador e o
 * horário: status, comprador, vendedor e preço vêm do servidor, e qualquer
 * campo a mais responde 400 pelo whitelist do ValidationPipe.
 */
export class CreateAppointmentDto {
    @ApiProperty({ format: 'uuid', description: 'Id do anúncio (precisa estar ACTIVE)' })
    @IsUUID()
    listingId: string;

    @ApiProperty({ format: 'uuid', description: 'Id do perfil do avaliador, como em GET /inspectors' })
    @IsUUID()
    inspectorProfileId: string;

    @ApiProperty({
        example: '2030-01-10T14:00:00.000Z',
        description: 'Início da avaliação em ISO 8601 com fuso (Z ou ±hh:mm)',
    })
    @IsISO8601({ strict: true })
    @Matches(/(Z|[+-]\d{2}:\d{2})$/, { message: 'startsAt must include a timezone (Z or ±hh:mm)' })
    startsAt: string;
}
