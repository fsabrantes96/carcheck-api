import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
    CITY_MAX_LENGTH,
    LISTING_PRICE_MAX_CENTS,
    PRICE_FILTER_MIN_CENTS,
    VEHICLE_BRAND_MAX_LENGTH,
    VEHICLE_YEAR_DESCRIPTION,
    VEHICLE_YEAR_MAX,
    VEHICLE_YEAR_MIN,
} from '../../common/limits.js';
import { BrazilianStateField } from '../../common/validation/brazilian-state.js';
import { ListingsPageQueryDto } from './listings-page-query.dto.js';

export class ListListingsQueryDto extends ListingsPageQueryDto {
    @ApiPropertyOptional({ example: 'Volkswagen', maxLength: VEHICLE_BRAND_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @MaxLength(VEHICLE_BRAND_MAX_LENGTH)
    brand?: string;

    @ApiPropertyOptional({ example: 'Boituva', maxLength: CITY_MAX_LENGTH })
    @IsOptional()
    @IsString()
    @MaxLength(CITY_MAX_LENGTH)
    city?: string;

    @BrazilianStateField({ optional: true })
    state?: string;

    @ApiPropertyOptional({
        type: 'integer',
        description: 'Preço mínimo em centavos',
        minimum: PRICE_FILTER_MIN_CENTS,
        maximum: LISTING_PRICE_MAX_CENTS,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PRICE_FILTER_MIN_CENTS)
    @Max(LISTING_PRICE_MAX_CENTS)
    minPriceCents?: number;

    @ApiPropertyOptional({
        type: 'integer',
        description: 'Preço máximo em centavos',
        minimum: PRICE_FILTER_MIN_CENTS,
        maximum: LISTING_PRICE_MAX_CENTS,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PRICE_FILTER_MIN_CENTS)
    @Max(LISTING_PRICE_MAX_CENTS)
    maxPriceCents?: number;

    // Sem maximum no Swagger (ver VehicleDto.year).
    @ApiPropertyOptional({ type: 'integer', example: 2015, minimum: VEHICLE_YEAR_MIN, description: VEHICLE_YEAR_DESCRIPTION })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(VEHICLE_YEAR_MIN)
    @Max(VEHICLE_YEAR_MAX)
    minYear?: number;

    @ApiPropertyOptional({ type: 'integer', example: 2022, minimum: VEHICLE_YEAR_MIN, description: VEHICLE_YEAR_DESCRIPTION })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(VEHICLE_YEAR_MIN)
    @Max(VEHICLE_YEAR_MAX)
    maxYear?: number;
}
