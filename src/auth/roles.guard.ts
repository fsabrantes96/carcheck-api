import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Role } from '../generated/prisma/client.js';
import { INVALID_TOKEN_MESSAGE } from './jwt-auth.guard.js';
import { ROLES_KEY } from './roles.decorator.js';
import type { AuthenticatedRequest } from './types/jwt-payload.js';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const required = this.reflector.getAllAndOverride<Role[] | undefined>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()],
        );

        if (!required) return true;
        // @Roles() vazio falha fechado: ninguém tem uma role da lista vazia.
        if (required.length === 0) {
            throw new ForbiddenException('Sem permissão para esta ação');
        }

        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        if (!request.user) throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);

        const user = await this.prisma.user.findUnique({
            where: { id: request.user.sub },
            select: { roles: true },
        });
        // Token válido de uma conta que não existe mais: para o cliente é o mesmo
        // caso de um token inválido (precisa entrar de novo).
        if (!user) throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);

        const allowed = required.some((role) => user.roles.includes(role));
        if (!allowed) throw new ForbiddenException('Sem permissão para esta ação');
        return true;
    }
}