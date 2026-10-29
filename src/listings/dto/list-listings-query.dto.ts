import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ListListingsQueryDto {
    @ApiPropertyOptional({ example: 'Volkswagen' })
    @IsOptional()
    @IsString()
    brand?: string;

    @ApiPropertyOptional({ example: 'Boituva' })
    @IsOptional()
    @IsString()
    city?: string;

    @ApiPropertyOptional({ example: 'SP' })
    @IsOptional()
    @IsString()
    @Length(2, 2)
    state?: string;

    @ApiPropertyOptional({ description: 'Preço mínimo em centavos' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    minPriceCents?: number;

    @ApiPropertyOptional({ description: 'Preço máximo em centavos' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    maxPriceCents?: number;

    @ApiPropertyOptional({ example: 2015 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    minYear?: number;

    @ApiPropertyOptional({ example: 2022 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    maxYear?: number;

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @ApiPropertyOptional({ default: 20, maximum: 50 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit: number = 20;
}