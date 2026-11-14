import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
    VEHICLE_BRAND_MAX_LENGTH,
    VEHICLE_BRAND_MIN_LENGTH,
    VEHICLE_MILEAGE_MAX_KM,
    VEHICLE_MILEAGE_MIN_KM,
    VEHICLE_MODEL_MAX_LENGTH,
    VEHICLE_MODEL_MIN_LENGTH,
    VEHICLE_YEAR_DESCRIPTION,
    VEHICLE_YEAR_MAX,
    VEHICLE_YEAR_MIN,
} from '../../common/limits.js';
import { FuelType, Transmission } from '../../generated/prisma/client.js';

export class VehicleDto {
    @ApiProperty({
        example: 'Volkswagen',
        minLength: VEHICLE_BRAND_MIN_LENGTH,
        maxLength: VEHICLE_BRAND_MAX_LENGTH,
    })
    @IsString()
    @MinLength(VEHICLE_BRAND_MIN_LENGTH)
    @MaxLength(VEHICLE_BRAND_MAX_LENGTH)
    brand: string;

    @ApiProperty({
        example: 'Gol',
        minLength: VEHICLE_MODEL_MIN_LENGTH,
        maxLength: VEHICLE_MODEL_MAX_LENGTH,
    })
    @IsString()
    @MinLength(VEHICLE_MODEL_MIN_LENGTH)
    @MaxLength(VEHICLE_MODEL_MAX_LENGTH)
    model: string;

    // Sem maximum no Swagger: o teto (ano atual + 1) muda a cada ano e o
    // openapi.json precisa ser determinístico. A regra fica na descrição.
    @ApiProperty({ type: 'integer', example: 2018, minimum: VEHICLE_YEAR_MIN, description: VEHICLE_YEAR_DESCRIPTION })
    @IsInt()
    @Min(VEHICLE_YEAR_MIN)
    @Max(VEHICLE_YEAR_MAX)
    year: number;

    @ApiProperty({
        type: 'integer',
        example: 68000,
        description: 'Quilometragem',
        minimum: VEHICLE_MILEAGE_MIN_KM,
        maximum: VEHICLE_MILEAGE_MAX_KM,
    })
    @IsInt()
    @Min(VEHICLE_MILEAGE_MIN_KM)
    @Max(VEHICLE_MILEAGE_MAX_KM)
    mileageKm: number;

    @ApiProperty({ enum: FuelType })
    @IsEnum(FuelType)
    fuel: FuelType;

    @ApiProperty({ enum: Transmission })
    @IsEnum(Transmission)
    transmission: Transmission;
}
