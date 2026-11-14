import { ApiProperty } from '@nestjs/swagger';
import { appointmentResponseSchema } from './appointment-response.dto.js';
import type { AppointmentResponseDto } from './appointment-response.dto.js';

export class PaginatedAppointmentsResponseDto {
    @ApiProperty({
        type: 'array',
        items: appointmentResponseSchema(),
        description: 'Cada item vem no formato do seu papel naquele agendamento (myRole)',
    })
    items: AppointmentResponseDto[];

    @ApiProperty({ type: 'integer' }) total: number;
    @ApiProperty({ type: 'integer' }) page: number;
    @ApiProperty({ type: 'integer' }) limit: number;
}
