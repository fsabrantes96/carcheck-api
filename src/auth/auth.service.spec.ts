import { ConflictException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { UserResponseDto } from './dto/user-response.dto.js';

// bcrypt.hash é lento: o mock evita o custo nos testes. No Windows, quando o
// cwd usa a letra do drive em minúsculo (c:\...), o Vitest não aplica o mock
// de pacotes de node_modules; por isso as asserções não dependem do valor dele.
vi.mock('bcrypt', () => ({
  hash: vi.fn().mockResolvedValue('hash-falso'),
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
});
