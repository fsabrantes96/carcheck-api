import { ApiProperty } from '@nestjs/swagger';
import {
    ArrayMinSize,
    ArrayUnique,
    IsArray,
    IsEnum,
    IsInt,
    IsString,
    Length,
    Max,
    Min,
    MinLength,
} from 'class-validator';
import { Specialty } from '../../generated/prisma/client.js';

export class CreateInspectorProfileDto {
    @ApiProperty({ example: 'Mecânico há 15 anos, especialista em câmbio.' })
    @IsString()
    @MinLength(20)
    bio: string;

    @ApiProperty({ enum: Specialty, isArray: true, example: ['ENGINE', 'BRAKES'] })
    @IsArray()
    @ArrayMinSize(1)
    @ArrayUnique()
    @IsEnum(Specialty, { each: true })
    specialties: Specialty[];

    @ApiProperty({ example: 'Barretos' })
    @IsString()
    @MinLength(2)
    city: string;

    @ApiProperty({ example: 'SP', description: 'Sigla do estado (2 letras)' })
    @IsString()
    @Length(2, 2)
    state: string;

    @ApiProperty({ example: 30, description: 'Raio de atendimento em km' })
    @IsInt()
    @Min(1)
    @Max(200)
    serviceRadiusKm: number;

    @ApiProperty({ example: 15000, description: 'Preço base em centavos (R$ 150,00 = 15000)' })
    @IsInt()
    @Min(0)
    basePriceCents: number;
}