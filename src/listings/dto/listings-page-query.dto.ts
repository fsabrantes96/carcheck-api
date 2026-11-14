import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
    LISTINGS_PAGE_MAX,
    PAGE_LIMIT_DEFAULT,
    PAGE_LIMIT_MAX,
    PAGE_LIMIT_MIN,
    PAGE_MIN,
} from '../../common/limits.js';

/**
 * Paginação das listagens de anúncio (GET /listings e GET /listings/mine),
 * com os mesmos limites nas duas.
 */
export class ListingsPageQueryDto {
    // Teto evita skip fora da faixa (page=1e20 virava 500) e varreduras
    // profundas: page × limit nunca passa de 10.000 registros pulados.
    @ApiPropertyOptional({ type: 'integer', default: PAGE_MIN, minimum: PAGE_MIN, maximum: LISTINGS_PAGE_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PAGE_MIN)
    @Max(LISTINGS_PAGE_MAX)
    page: number = PAGE_MIN;

    @ApiPropertyOptional({ type: 'integer', default: PAGE_LIMIT_DEFAULT, minimum: PAGE_LIMIT_MIN, maximum: PAGE_LIMIT_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PAGE_LIMIT_MIN)
    @Max(PAGE_LIMIT_MAX)
    limit: number = PAGE_LIMIT_DEFAULT;
}
