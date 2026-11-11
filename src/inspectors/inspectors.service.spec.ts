import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { InspectorResponseDto } from './dto/inspector-response.dto.js';
import type { CreateInspectorProfileDto } from './dto/create-inspector-profile.dto.js';
import { InspectorsService } from './inspectors.service.js';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erro do prisma', {
    code,
    clientVersion: 'test',
    meta: { target: ['userId'] },
  });
}

const dto = {
  bio: 'Mecânico há 15 anos, especialista em câmbio.',
  specialties: ['ENGINE', 'BRAKES'],
  city: 'Barretos',
  state: 'SP',
  serviceRadiusKm: 30,
  basePriceCents: 15000,
} satisfies CreateInspectorProfileDto;

type PrismaMock = {
  inspectorProfile: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

describe('InspectorsService', () => {
  let prisma: PrismaMock;
  let service: InspectorsService;

  beforeEach(() => {
    prisma = {
      inspectorProfile: { findUnique: vi.fn(), create: vi.fn() },
      user: { update: vi.fn() },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: PrismaMock) => Promise<unknown>) => callback(prisma),
    );
    service = new InspectorsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('cria o perfil, adiciona o role INSPECTOR e devolve o InspectorResponseDto', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(null);
      prisma.inspectorProfile.create.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        ...dto,
        verified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'u1',
          name: 'João',
          email: 'joao@x.com',
          passwordHash: 'hash',
        },
      });

      const result = await service.create('u1', dto);

      expect(result).toBeInstanceOf(InspectorResponseDto);
      expect(result).toEqual({
        id: 'p1',
        name: 'João',
        ...dto,
        verified: false,
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('userId');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { roles: { push: 'INSPECTOR' } },
      });
    });

    it('lança ConflictException quando o usuário já tem perfil na checagem prévia', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue({ id: 'p1' });

      const promise = service.create('u1', dto);

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow(
        'Você já possui perfil de avaliador',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando o create estoura P2002 (corrida)', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(null);
      prisma.inspectorProfile.create.mockRejectedValue(prismaError('P2002'));

      const promise = service.create('u1', dto);

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow(
        'Você já possui perfil de avaliador',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('relança sem alteração um erro do Prisma diferente de P2002', async () => {
      const error = prismaError('P2003');
      prisma.inspectorProfile.findUnique.mockResolvedValue(null);
      prisma.inspectorProfile.create.mockRejectedValue(error);

      await expect(service.create('u1', dto)).rejects.toBe(error);
    });

    it('relança sem alteração um erro genérico', async () => {
      const error = new Error('conexão perdida');
      prisma.inspectorProfile.findUnique.mockResolvedValue(null);
      prisma.inspectorProfile.create.mockRejectedValue(error);

      await expect(service.create('u1', dto)).rejects.toBe(error);
    });
  });
});
