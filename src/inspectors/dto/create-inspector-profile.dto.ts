import { ApiProperty } from '@nestjs/swagger';
import {
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsEnum,
    IsInt,
    IsString,
    Length,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';
import {
    CITY_MAX_LENGTH,
    CITY_MIN_LENGTH,
    INSPECTION_PRICE_MAX_CENTS,
    INSPECTION_PRICE_MIN_CENTS,
    INSPECTOR_BIO_MAX_LENGTH,
    INSPECTOR_BIO_MIN_LENGTH,
    SERVICE_RADIUS_MAX_KM,
    SERVICE_RADIUS_MIN_KM,
    STATE_LENGTH,
} from '../../common/limits.js';
import { Specialty } from '../../generated/prisma/client.js';

export class CreateInspectorProfileDto {
    @ApiProperty({
        example: 'Mecânico há 15 anos, especialista em câmbio.',
        minLength: INSPECTOR_BIO_MIN_LENGTH,
        maxLength: INSPECTOR_BIO_MAX_LENGTH,
    })
    @IsString()
    @MinLength(INSPECTOR_BIO_MIN_LENGTH)
    @MaxLength(INSPECTOR_BIO_MAX_LENGTH)
    bio: string;

    @ApiProperty({ enum: Specialty, isArray: true, example: ['ENGINE', 'BRAKES'] })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayUnique()
    @IsEnum(Specialty, { each: true })
    specialties: Specialty[];

    @ApiProperty({ example: 'Barretos', minLength: CITY_MIN_LENGTH, maxLength: CITY_MAX_LENGTH })
    @IsString()
    @MinLength(CITY_MIN_LENGTH)
    @MaxLength(CITY_MAX_LENGTH)
    city: string;

    @ApiProperty({
        example: 'SP',
        description: 'Sigla do estado (2 letras)',
        minLength: STATE_LENGTH,
        maxLength: STATE_LENGTH,
    })
    @IsString()
    @Length(STATE_LENGTH, STATE_LENGTH)
    state: string;

    @ApiProperty({
        example: 30,
        description: 'Raio de atendimento em km',
        minimum: SERVICE_RADIUS_MIN_KM,
        maximum: SERVICE_RADIUS_MAX_KM,
    })
    @IsInt()
    @Min(SERVICE_RADIUS_MIN_KM)
    @Max(SERVICE_RADIUS_MAX_KM)
    serviceRadiusKm: number;

    @ApiProperty({
        example: 15000,
        description:
            'Preço base em centavos (R$ 150,00 = 15000). Abaixo do mínimo da plataforma, o avaliador não recebe pedidos',
        minimum: INSPECTION_PRICE_MIN_CENTS,
        maximum: INSPECTION_PRICE_MAX_CENTS,
    })
    @IsInt()
    @Min(INSPECTION_PRICE_MIN_CENTS)
    @Max(INSPECTION_PRICE_MAX_CENTS)
    basePriceCents: number;
}
