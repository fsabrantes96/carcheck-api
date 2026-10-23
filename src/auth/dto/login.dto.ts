import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto {
    @ApiProperty({ example: 'maria@email.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: 'senha12345' })
    @IsString()
    @MinLength(8)
    password: string;
}