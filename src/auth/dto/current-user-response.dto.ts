import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../generated/prisma/client.js';
import { UserResponseDto } from './user-response.dto.js';

/**
 * Resposta de GET /auth/me: os dados do usuário mais as roles atuais, lidas
 * do banco a cada requisição (não vêm do token). Register e login continuam
 * com UserResponseDto, sem roles.
 */
export class CurrentUserResponseDto extends UserResponseDto {
    @ApiProperty({
        enum: Role,
        enumName: 'Role',
        isArray: true,
        description: 'Roles atuais do usuário, lidas do banco (uma mudança vale na hora, sem novo login)',
    })
    roles: Role[];

    /** override: sem ele, CurrentUserResponseDto.from herdado devolveria um UserResponseDto sem roles. */
    static override from(user: { id: string; name: string; email: string; roles: Role[]; createdAt: Date }): CurrentUserResponseDto {
        const dto = new CurrentUserResponseDto();
        dto.id = user.id;
        dto.name = user.name;
        dto.email = user.email;
        dto.roles = [...user.roles];
        dto.createdAt = user.createdAt;
        return dto;
    }
}
