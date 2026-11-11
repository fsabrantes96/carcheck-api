import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Confirmação do vendedor: o local da avaliação (o horário já veio no pedido). */
export class ConfirmAppointmentDto {
    @ApiProperty({ example: 'Rua das Flores, 123, Boituva/SP', minLength: 5, maxLength: 300 })
    @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @Length(5, 300)
    meetingAddress: string;
}
