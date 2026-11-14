import { ApiProperty } from '@nestjs/swagger';
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsEnum,
    IsInt,
    IsString,
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
    SPECIALTIES_MAX_ITEMS,
    SPECIALTIES_MIN_ITEMS,
} from '../../common/limits.js';
import { BrazilianStateField } from '../../common/validation/brazilian-state.js';
import { UniqueArray } from '../../common/validation/unique-array.js';
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

    @ApiProperty({
        enum: Specialty,
        isArray: true,
        example: ['ENGINE', 'BRAKES'],
        minItems: SPECIALTIES_MIN_ITEMS,
        maxItems: SPECIALTIES_MAX_ITEMS,
        uniqueItems: true,
    })
    @IsArray()
    @ArrayMinSize(SPECIALTIES_MIN_ITEMS)
    @ArrayMaxSize(SPECIALTIES_MAX_ITEMS)
    @UniqueArray()
    @IsEnum(Specialty, { each: true })
    specialties: Specialty[];

    @ApiProperty({ example: 'Barretos', minLength: CITY_MIN_LENGTH, maxLength: CITY_MAX_LENGTH })
    @IsString()
    @MinLength(CITY_MIN_LENGTH)
    @MaxLength(CITY_MAX_LENGTH)
    city: string;

    @BrazilianStateField()
    state: string;

    @ApiProperty({
        type: 'integer',
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
        type: 'integer',
        example: 15000,
        description:
            'Preço base em centavos (R$ 150,00 = 15000). Abaixo do mínimo da plataforma (MIN_INSPECTION_PRICE_CENTS, padrão R$ 50,00) responde 400',
        minimum: INSPECTION_PRICE_MIN_CENTS,
        maximum: INSPECTION_PRICE_MAX_CENTS,
    })
    @IsInt()
    @Min(INSPECTION_PRICE_MIN_CENTS)
    @Max(INSPECTION_PRICE_MAX_CENTS)
    basePriceCents: number;
}
