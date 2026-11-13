import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../common/limits.js';
import { MaxBytes } from '../../common/validation/max-bytes.js';

export class RegisterDto {
  @ApiProperty({ example: 'Maria Silva', minLength: NAME_MIN_LENGTH, maxLength: NAME_MAX_LENGTH })
  @IsString()
  @MinLength(NAME_MIN_LENGTH)
  @MaxLength(NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ example: 'maria@email.com', maxLength: EMAIL_MAX_LENGTH })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email: string;

  // O bcrypt só considera os primeiros 72 bytes da senha: além dos 72
  // caracteres, a senha é medida em bytes UTF-8 (acentos e emoji contam mais).
  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
    description: `No máximo ${PASSWORD_MAX_BYTES} bytes em UTF-8 (acentos ocupam 2 bytes; emoji, 4)`,
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @MaxBytes(PASSWORD_MAX_BYTES)
  password: string;
}
