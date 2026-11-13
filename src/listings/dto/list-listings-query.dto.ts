import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import {
    CITY_MAX_LENGTH,
    LISTING_PRICE_MAX_CENTS,
    LISTINGS_PAGE_MAX,
    PAGE_LIMIT_DEFAULT,
    PAGE_LIMIT_MAX,
    PAGE_LIMIT_MIN,
    PAGE_MIN,
    PRICE_FILTER_MIN_CENTS,
    STATE_LENGTH,
    VEHICLE_BRAND_MAX_LENGTH,
    VEHICLE_YEAR_MAX,
    VEHICLE_YEAR_MIN,
} from '../../common/limits.js';

export class ListListingsQueryDto {
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

    @ApiPropertyOptional({ example: 'SP', minLength: STATE_LENGTH, maxLength: STATE_LENGTH })
    @IsOptional()
    @IsString()
    @Length(STATE_LENGTH, STATE_LENGTH)
    state?: string;

    @ApiPropertyOptional({
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

    @ApiPropertyOptional({ example: 2015, minimum: VEHICLE_YEAR_MIN, maximum: VEHICLE_YEAR_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(VEHICLE_YEAR_MIN)
    @Max(VEHICLE_YEAR_MAX)
    minYear?: number;

    @ApiPropertyOptional({ example: 2022, minimum: VEHICLE_YEAR_MIN, maximum: VEHICLE_YEAR_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(VEHICLE_YEAR_MIN)
    @Max(VEHICLE_YEAR_MAX)
    maxYear?: number;

    // Teto evita skip fora da faixa (page=1e20 virava 500) e varreduras
    // profundas: page × limit nunca passa de 10.000 registros pulados.
    @ApiPropertyOptional({ default: PAGE_MIN, minimum: PAGE_MIN, maximum: LISTINGS_PAGE_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PAGE_MIN)
    @Max(LISTINGS_PAGE_MAX)
    page: number = PAGE_MIN;

    @ApiPropertyOptional({ default: PAGE_LIMIT_DEFAULT, minimum: PAGE_LIMIT_MIN, maximum: PAGE_LIMIT_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PAGE_LIMIT_MIN)
    @Max(PAGE_LIMIT_MAX)
    limit: number = PAGE_LIMIT_DEFAULT;
}
