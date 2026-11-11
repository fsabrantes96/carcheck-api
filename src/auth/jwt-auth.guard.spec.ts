import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthenticatedRequest, JwtPayload } from './types/jwt-payload.js';

function criarRequest(authorization?: string): AuthenticatedRequest {
  return {
    headers: authorization === undefined ? {} : { authorization },
  } as AuthenticatedRequest;
}

function criarContexto(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const payload: JwtPayload = { sub: 'user-1', email: 'maria@x.com' };

describe('JwtAuthGuard', () => {
  let jwt: { verifyAsync: ReturnType<typeof vi.fn> };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    jwt = { verifyAsync: vi.fn() };
    guard = new JwtAuthGuard(jwt as unknown as JwtService);
  });

  it('lança 401 "Token não informado" sem chamar verifyAsync quando não há header Authorization', async () => {
    const promise = guard.canActivate(criarContexto(criarRequest()));

    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(promise).rejects.toThrow('Token não informado');
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('lança 401 "Token não informado" sem chamar verifyAsync quando o esquema não é Bearer', async () => {
    const promise = guard.canActivate(criarContexto(criarRequest('Basic x')));

    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(promise).rejects.toThrow('Token não informado');
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
  });

  it('lança 401 "Token inválido ou expirado" quando verifyAsync rejeita', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    const promise = guard.canActivate(
      criarContexto(criarRequest('Bearer token-ruim')),
    );

    await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(promise).rejects.toThrow('Token inválido ou expirado');
  });

  it('não preenche request.user quando o token é inválido', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
    const request = criarRequest('Bearer token-ruim');

    await expect(guard.canActivate(criarContexto(request))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(request.user).toBeUndefined();
  });

  it('verifica o token que vem depois de "Bearer "', async () => {
    jwt.verifyAsync.mockResolvedValue(payload);

    await guard.canActivate(criarContexto(criarRequest('Bearer token-bom')));

    expect(jwt.verifyAsync).toHaveBeenCalledWith('token-bom');
  });

  it('retorna true e preenche request.user com o payload quando o token é válido', async () => {
    jwt.verifyAsync.mockResolvedValue(payload);
    const request = criarRequest('Bearer token-bom');

    await expect(guard.canActivate(criarContexto(request))).resolves.toBe(true);
    expect(request.user).toEqual(payload);
  });
});
