import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Max, Min, MinLength } from 'class-validator';
import { FuelType, Transmission } from '../../generated/prisma/client.js';

export class VehicleDto {
    @ApiProperty({ example: 'Volkswagen' })
    @IsString()
    @MinLength(2)
    brand: string;

    @ApiProperty({ example: 'Gol' })
    @IsString()
    @MinLength(1)
    model: string;

    @ApiProperty({ example: 2018 })
    @IsInt()
    @Min(1950)
    @Max(new Date().getFullYear() + 1)
    year: number;

    @ApiProperty({ example: 68000, description: 'Quilometragem' })
    @IsInt()
    @Min(0)
    mileageKm: number;

    @ApiProperty({ enum: FuelType })
    @IsEnum(FuelType)
    fuel: FuelType;

    @ApiProperty({ enum: Transmission })
    @IsEnum(Transmission)
    transmission: Transmission;
}