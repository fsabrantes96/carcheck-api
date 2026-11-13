import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
    APPOINTMENTS_PAGE_MAX,
    PAGE_LIMIT_DEFAULT,
    PAGE_LIMIT_MAX,
    PAGE_LIMIT_MIN,
    PAGE_MIN,
} from '../../common/limits.js';
import { AppointmentStatus } from '../../generated/prisma/client.js';
import type { Participant } from '../appointments.state-machine.js';

const PARTICIPANTS: Participant[] = ['BUYER', 'SELLER', 'INSPECTOR'];

export class ListAppointmentsQueryDto {
    @ApiPropertyOptional({ enum: PARTICIPANTS, description: 'Só os agendamentos em que você tem este papel' })
    @IsOptional()
    @IsIn(PARTICIPANTS)
    as?: Participant;

    @ApiPropertyOptional({ enum: AppointmentStatus })
    @IsOptional()
    @IsEnum(AppointmentStatus)
    status?: AppointmentStatus;

    // Teto evita skip fora da faixa (page=1e20 virava 500). 10000 × 50 itens
    // cobre de sobra a lista de um usuário.
    @ApiPropertyOptional({ default: PAGE_MIN, minimum: PAGE_MIN, maximum: APPOINTMENTS_PAGE_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PAGE_MIN)
    @Max(APPOINTMENTS_PAGE_MAX)
    page: number = PAGE_MIN;

    @ApiPropertyOptional({ default: PAGE_LIMIT_DEFAULT, minimum: PAGE_LIMIT_MIN, maximum: PAGE_LIMIT_MAX })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(PAGE_LIMIT_MIN)
    @Max(PAGE_LIMIT_MAX)
    limit: number = PAGE_LIMIT_DEFAULT;
}
