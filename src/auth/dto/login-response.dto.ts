import { ApiProperty } from "@nestjs/swagger";
import { UserResponseDto } from "./user-response.dto.js";

export class LoginResponseDto {
    @ApiProperty({ description: 'Enviar no header Authorization: Bearer <token>' })
    accessToken: string;

    @ApiProperty({ type: UserResponseDto })
    user: UserResponseDto;
}