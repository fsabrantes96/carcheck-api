import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
    @ApiProperty() id: string;
    @ApiProperty() name: string;
    @ApiProperty() email: string;
    @ApiProperty() createdAt: Date;

    static from(user: {id: string; name: string; email: string; createdAt: Date}) {
        const dto = new UserResponseDto();
        dto.id = user.id;
        dto.name = user.name;
        dto.email = user.email;
        dto.createdAt = user.createdAt;
        return dto;
    }
}