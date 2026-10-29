import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsInt,
    IsString,
    Length,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator';
import { VehicleDto } from './vehicle.dto.js';

export class CreateListingDto {
    @ApiProperty({ example: 'Gol 1.0 2018 completo' })
    @IsString()
    @MinLength(5)
    title: string;

    @ApiProperty({ example: 'Único dono, revisões em dia, pneus novos.' })
    @IsString()
    @MinLength(20)
    description: string;

    @ApiProperty({ example: 4500000, description: 'Preço em centavos (R$ 45.000,00)' })
    @IsInt()
    @Min(1)
    priceCents: number;

    @ApiProperty({ example: 'Boituva' })
    @IsString()
    @MinLength(2)
    city: string;

    @ApiProperty({ example: 'SP' })
    @IsString()
    @Length(2, 2)
    state: string;

    @ApiProperty({ type: VehicleDto })
    @ValidateNested()
    @Type(() => VehicleDto)
    vehicle: VehicleDto;
}