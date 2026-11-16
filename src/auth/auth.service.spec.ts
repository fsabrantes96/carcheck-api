import {
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { rejectionCode } from '../../test/support/error-code.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { CurrentUserResponseDto } from './dto/current-user-response.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';

// bcrypt.hash é lento: o mock evita o custo nos testes. Mock de pacote de
// node_modules depende do root canônico do vitest.config.ts (no Windows, com o
// cwd em c:\ minúsculo, ele deixava de valer); a trava no beforeAll confere.
vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('hash-falso'),
  // hashSync roda na importação do service (hash fixo do login): devolve
  // string para o teste não depender de undefined.
  hashSync: vi.fn().mockReturnValue('hash-fixo-falso'),
  compare: vi.fn(),
}));

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erro do prisma', {
    code,
    clientVersion: 'test',
    meta: { target: ['email'] },
  });
}

const dto = {
  name: 'Maria Silva',
  email: 'maria@x.com',
  password: 'senha12345',
};

describe('AuthService', () => {
  // Trava: sem o mock, os testes de register rodariam o bcrypt real em
  // silêncio e os de login quebrariam com um erro que não aponta a causa.
  beforeAll(() => {
    const message =
      "o vi.mock('bcrypt') não foi aplicado; veja o root no vitest.config.ts";
    expect(vi.isMockFunction(bcrypt.hash), message).toBe(true);
    expect(vi.isMockFunction(bcrypt.compare), message).toBe(true);
  });

  let prisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let service: AuthService;

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn(), create: vi.fn() } };
    service = new AuthService(
      prisma as unknown as PrismaService,
      {} as JwtService,
    );
  });

  describe('register', () => {
    it('cria o usuário e devolve o UserResponseDto sem passwordHash', async () => {
      const createdAt = new Date('2026-11-10T12:00:00.000Z');
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u1',
        name: dto.name,
        email: dto.email,
        passwordHash: 'hash-falso',
        roles: ['USER'],
        createdAt,
      });

      const result = await service.register(dto);

      expect(result).toBeInstanceOf(UserResponseDto);
      expect(result).toEqual({
        id: 'u1',
        name: dto.name,
        email: dto.email,
        createdAt,
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash: expect.any(String),
        },
      });
    });

    it('não grava a senha em texto puro', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u1',
        name: dto.name,
        email: dto.email,
        passwordHash: 'hash-falso',
        createdAt: new Date(),
      });

      await service.register(dto);

      const { data } = prisma.user.create.mock.calls[0][0] as {
        data: { passwordHash: string };
      };
      expect(data.passwordHash).not.toBe(dto.password);
    });

    it('lança ConflictException quando o e-mail já existe na checagem prévia', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

      const promise = service.register(dto);

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow('E-mail já cadastrado');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando o create estoura P2002 (corrida)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(prismaError('P2002'));

      const promise = service.register(dto);

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow('E-mail já cadastrado');
    });

    it('relança sem alteração um erro do Prisma diferente de P2002', async () => {
      const error = prismaError('P2003');
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(error);

      await expect(service.register(dto)).rejects.toBe(error);
    });

    it('relança sem alteração um erro genérico', async () => {
      const error = new Error('conexão perdida');
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(error);

      await expect(service.register(dto)).rejects.toBe(error);
    });
  });

  // Estes casos dependem do vi.mock('bcrypt') acima (conferido no beforeAll).
  describe('login', () => {
    const loginDto = { email: 'maria@x.com', password: 'senha12345' };
    const user = {
      id: 'u1',
      name: 'Maria Silva',
      email: 'maria@x.com',
      passwordHash: 'hash-do-usuario',
      roles: ['USER'],
      createdAt: new Date('2026-11-10T12:00:00.000Z'),
    };
    let compare: ReturnType<typeof vi.fn>;
    let jwt: { signAsync: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      compare = vi.mocked(bcrypt.compare) as unknown as ReturnType<
        typeof vi.fn
      >;
      compare.mockReset();
      jwt = { signAsync: vi.fn().mockResolvedValue('token-jwt') };
      service = new AuthService(
        prisma as unknown as PrismaService,
        jwt as unknown as JwtService,
      );
    });

    it('devolve accessToken e o usuário sem passwordHash quando a senha confere', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      compare.mockResolvedValue(true);

      const result = await service.login(loginDto);

      expect(result).toEqual({
        accessToken: 'token-jwt',
        user: {
          id: 'u1',
          name: 'Maria Silva',
          email: 'maria@x.com',
          createdAt: user.createdAt,
        },
      });
      expect(result.user).toBeInstanceOf(UserResponseDto);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'u1',
        email: 'maria@x.com',
      });
    });

    it('compara a senha com o passwordHash do usuário e lança 401 quando ela não confere', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      compare.mockResolvedValue(false);

      const promise = service.login(loginDto);

      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(promise).rejects.toThrow('E-mail ou senha inválidos');
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare).toHaveBeenCalledWith(
        loginDto.password,
        'hash-do-usuario',
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('executa bcrypt.compare com um hash fixo quando o usuário não existe (tempo constante) e lança 401', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      // Mesmo que o compare dissesse "confere", sem usuário o login falha.
      compare.mockResolvedValue(true);

      const promise = service.login(loginDto);

      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(promise).rejects.toThrow('E-mail ou senha inválidos');
      expect(compare).toHaveBeenCalledTimes(1);
      expect(compare).toHaveBeenCalledWith(
        loginDto.password,
        expect.any(String),
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('devolve o CurrentUserResponseDto com as roles do banco, sem passwordHash', async () => {
      const createdAt = new Date('2026-11-10T12:00:00.000Z');
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        name: 'Maria Silva',
        email: 'maria@x.com',
        passwordHash: 'hash-do-usuario',
        roles: ['USER'],
        createdAt,
      });

      const result = await service.me('u1');

      expect(result).toBeInstanceOf(CurrentUserResponseDto);
      expect(result).toEqual({
        id: 'u1',
        name: 'Maria Silva',
        email: 'maria@x.com',
        roles: ['USER'],
        createdAt,
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'u1' },
      });
    });

    it('lança 401 "Token inválido ou expirado" quando o usuário do token não existe mais', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const promise = service.me('u1');

      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(promise).rejects.toThrow('Token inválido ou expirado');
      expect(await rejectionCode(service.me('u1'))).toBe('UNAUTHENTICATED');
    });
  });
});
