import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
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
