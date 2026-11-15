import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import {
    PAGE_LIMIT_DEFAULT,
    PAGE_LIMIT_MAX,
    PAGE_LIMIT_MIN,
    PAGE_MAX,
    PAGE_MIN,
} from '../limits.js';

/** Regra de paginação para as descrições do 400 no Swagger. */
export const PAGINATION_RULE = `page de ${PAGE_MIN} a ${PAGE_MAX}, limit de ${PAGE_LIMIT_MIN} a ${PAGE_LIMIT_MAX}`;

/**
 * Paginação comum (GET /listings, GET /listings/mine e GET /inspectors), com
 * os mesmos limites em todas. GET /appointments tem a própria (teto maior).
 */
export class PageQueryDto {
    // Teto evita skip fora da faixa (page=1e20 virava 500) e varreduras
    // profundas: page × limit nunca passa de 10.000 registros pulados.
    @ApiPropertyOptional({ type: 'integer', default: PAGE_MIN, minimum: PAGE_MIN, maximum: PAGE_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PAGE_MIN)
    @Max(PAGE_MAX)
    page: number = PAGE_MIN;

    @ApiPropertyOptional({ type: 'integer', default: PAGE_LIMIT_DEFAULT, minimum: PAGE_LIMIT_MIN, maximum: PAGE_LIMIT_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PAGE_LIMIT_MIN)
    @Max(PAGE_LIMIT_MAX)
    limit: number = PAGE_LIMIT_DEFAULT;
}
