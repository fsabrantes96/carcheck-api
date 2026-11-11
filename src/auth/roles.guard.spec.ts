import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';
import type { JwtPayload } from './types/jwt-payload.js';

// Controllers de mentira: o Reflector real lê os metadados do @Roles,
// então o teste cobre também a precedência handler > classe.
// `this: void` porque o teste passa os métodos soltos como handler.
class SemRolesController {
  rota(this: void) {}
}

@Roles(Role.ADMIN)
class AdminController {
  semRolesNoHandler(this: void) {}

  @Roles(Role.INSPECTOR)
  inspectorNoHandler(this: void) {}
}

class HandlerController {
  @Roles(Role.INSPECTOR, Role.ADMIN)
  inspectorOuAdmin(this: void) {}

  @Roles()
  rolesVazio(this: void) {}
}

function criarContexto(
  classe: new () => unknown,
  handler: () => void,
  user?: JwtPayload,
): ExecutionContext {
  const request = { user };
  return {
    getClass: () => classe,
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const usuario: JwtPayload = { sub: 'user-1', email: 'maria@x.com' };

describe('RolesGuard', () => {
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn> } };
  let guard: RolesGuard;

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn() } };
    guard = new RolesGuard(new Reflector(), prisma as unknown as PrismaService);
  });

  describe('quando a rota não exige roles', () => {
    it('libera o acesso sem consultar o banco quando não há @Roles', async () => {
      const ctx = criarContexto(SemRolesController, SemRolesController.prototype.rota);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('libera o acesso sem consultar o banco quando @Roles está vazio', async () => {
      const ctx = criarContexto(HandlerController, HandlerController.prototype.rolesVazio);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('libera o acesso mesmo sem usuário autenticado', async () => {
      const ctx = criarContexto(SemRolesController, SemRolesController.prototype.rota);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('quando a rota exige roles', () => {
    const rotaInspectorOuAdmin = () =>
      criarContexto(HandlerController, HandlerController.prototype.inspectorOuAdmin, usuario);

    it('lança 401 sem consultar o banco quando não há usuário na requisição', async () => {
      const ctx = criarContexto(HandlerController, HandlerController.prototype.inspectorOuAdmin);

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('lança 401 quando o usuário do token não existe mais no banco', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(rotaInspectorOuAdmin())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('busca as roles no banco pelo sub do token, selecionando só roles', async () => {
      prisma.user.findUnique.mockResolvedValue({ roles: [Role.ADMIN] });

      await guard.canActivate(rotaInspectorOuAdmin());

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { roles: true },
      });
    });

    it.each<[string, Role[]]>([
      ['só INSPECTOR', [Role.INSPECTOR]],
      ['só ADMIN', [Role.ADMIN]],
      ['USER e INSPECTOR', [Role.USER, Role.INSPECTOR]],
      ['todas as roles', [Role.USER, Role.INSPECTOR, Role.ADMIN]],
    ])('libera o acesso quando o usuário tem %s', async (_descricao, roles) => {
      prisma.user.findUnique.mockResolvedValue({ roles });

      await expect(guard.canActivate(rotaInspectorOuAdmin())).resolves.toBe(true);
    });

    it.each<[string, Role[]]>([
      ['só USER', [Role.USER]],
      ['nenhuma role', []],
    ])('lança 403 quando o usuário tem %s', async (_descricao, roles) => {
      prisma.user.findUnique.mockResolvedValue({ roles });

      await expect(guard.canActivate(rotaInspectorOuAdmin())).rejects.toThrow(
        new ForbiddenException('Sem permissão para esta ação'),
      );
    });
  });

  describe('precedência dos metadados', () => {
    it('usa as roles da classe quando o handler não declara @Roles', async () => {
      prisma.user.findUnique.mockResolvedValue({ roles: [Role.INSPECTOR] });
      const ctx = criarContexto(
        AdminController,
        AdminController.prototype.semRolesNoHandler,
        usuario,
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('libera pela role da classe quando o handler não declara @Roles', async () => {
      prisma.user.findUnique.mockResolvedValue({ roles: [Role.ADMIN] });
      const ctx = criarContexto(
        AdminController,
        AdminController.prototype.semRolesNoHandler,
        usuario,
      );

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('as roles do handler substituem as da classe', async () => {
      prisma.user.findUnique.mockResolvedValue({ roles: [Role.INSPECTOR] });
      const ctx = criarContexto(
        AdminController,
        AdminController.prototype.inspectorNoHandler,
        usuario,
      );

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('com @Roles no handler, a role da classe sozinha não basta', async () => {
      prisma.user.findUnique.mockResolvedValue({ roles: [Role.ADMIN] });
      const ctx = criarContexto(
        AdminController,
        AdminController.prototype.inspectorNoHandler,
        usuario,
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });
});
