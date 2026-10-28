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
import { ROLES_KEY } from './roles.decorator.js';
import type { AuthenticatedRequest } from './types/jwt-payload.js';
import { Observable } from 'rxjs';

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

        if (!required || required.length === 0) return true;

        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        if (!request.user) throw new UnauthorizedException();

        const user = await this.prisma.user.findUnique({
            where: { id: request.user.sub },
            select: { roles: true },
        });
        if (!user) throw new UnauthorizedException();

        const allowed = required.some((role) => user.roles.includes(role));
        if (!allowed) throw new ForbiddenException('Sem permissão para esta ação');
        return true;
    }
}