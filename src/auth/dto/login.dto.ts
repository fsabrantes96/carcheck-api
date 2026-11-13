import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../common/limits.js';

export class LoginDto {
  @ApiProperty({ example: 'maria@email.com', maxLength: EMAIL_MAX_LENGTH })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  // Mesmo tamanho em caracteres do RegisterDto. A medida em bytes fica só no
  // cadastro: aqui uma senha longa segue para o 401 genérico do service, em
  // tempo constante, sem revelar o limite.
  @ApiProperty({ example: 'senha12345', minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}
