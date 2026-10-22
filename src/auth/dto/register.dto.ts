import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
    @ApiProperty({ example: 'Maria Silva' })
    @IsString()
    @MinLength(2)
    name: string;

    @ApiProperty({example: 'maria@email.com'})
    @IsEmail()
    email: string;

    @ApiProperty({minLength: 8})
    @IsString()
    @MinLength(8)
    password: string;
}