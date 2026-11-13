import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MEETING_ADDRESS_MAX_LENGTH, MEETING_ADDRESS_MIN_LENGTH } from '../../common/limits.js';

/** Confirmação do vendedor: o local da avaliação (o horário já veio no pedido). */
export class ConfirmAppointmentDto {
    @ApiProperty({ example: 'Rua das Flores, 123, Boituva/SP', minLength: MEETING_ADDRESS_MIN_LENGTH, maxLength: MEETING_ADDRESS_MAX_LENGTH })
    @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @Length(MEETING_ADDRESS_MIN_LENGTH, MEETING_ADDRESS_MAX_LENGTH)
    meetingAddress: string;
}
