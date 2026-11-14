import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsInt,
    IsString,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import {
    CITY_MAX_LENGTH,
    CITY_MIN_LENGTH,
    LISTING_DESCRIPTION_MAX_LENGTH,
    LISTING_DESCRIPTION_MIN_LENGTH,
    LISTING_PRICE_MAX_CENTS,
    LISTING_PRICE_MIN_CENTS,
    LISTING_TITLE_MAX_LENGTH,
    LISTING_TITLE_MIN_LENGTH,
} from '../../common/limits.js';
import { BrazilianStateField } from '../../common/validation/brazilian-state.js';
import { VehicleDto } from './vehicle.dto.js';

export class CreateListingDto {
    @ApiProperty({
        example: 'Gol 1.0 2018 completo',
        minLength: LISTING_TITLE_MIN_LENGTH,
        maxLength: LISTING_TITLE_MAX_LENGTH,
    })
    @IsString()
    @MinLength(LISTING_TITLE_MIN_LENGTH)
    @MaxLength(LISTING_TITLE_MAX_LENGTH)
    title: string;

    @ApiProperty({
        example: 'Único dono, revisões em dia, pneus novos.',
        minLength: LISTING_DESCRIPTION_MIN_LENGTH,
        maxLength: LISTING_DESCRIPTION_MAX_LENGTH,
    })
    @IsString()
    @MinLength(LISTING_DESCRIPTION_MIN_LENGTH)
    @MaxLength(LISTING_DESCRIPTION_MAX_LENGTH)
    description: string;

    @ApiProperty({
        type: 'integer',
        example: 4500000,
        description: 'Preço em centavos (R$ 45.000,00)',
        minimum: LISTING_PRICE_MIN_CENTS,
        maximum: LISTING_PRICE_MAX_CENTS,
    })
    @IsInt()
    @Min(LISTING_PRICE_MIN_CENTS)
    @Max(LISTING_PRICE_MAX_CENTS)
    priceCents: number;

    @ApiProperty({ example: 'Boituva', minLength: CITY_MIN_LENGTH, maxLength: CITY_MAX_LENGTH })
    @IsString()
    @MinLength(CITY_MIN_LENGTH)
    @MaxLength(CITY_MAX_LENGTH)
    city: string;

    @BrazilianStateField()
    state: string;

    @ApiProperty({ type: VehicleDto })
    @ValidateNested()
    @Type(() => VehicleDto)
    vehicle: VehicleDto;
}
