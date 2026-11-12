import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { BusinessRules } from '../config/business-rules.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { InspectorResponseDto } from './dto/inspector-response.dto.js';
import { MyInspectorProfileResponseDto } from './dto/my-inspector-profile-response.dto.js';
import type { CreateInspectorProfileDto } from './dto/create-inspector-profile.dto.js';
import type { UpdateInspectorProfileDto } from './dto/update-inspector-profile.dto.js';
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

const rules: BusinessRules = {
  platformFeeBps: 1000,
  minInspectionPriceCents: 5000,
  appointmentDurationMinutes: 60,
  appointmentMinNoticeHours: 24,
};

type PrismaMock = {
  inspectorProfile: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

describe('InspectorsService', () => {
  let prisma: PrismaMock;
  let service: InspectorsService;

  beforeEach(() => {
    prisma = {
      inspectorProfile: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      user: { update: vi.fn() },
      $transaction: vi.fn(),
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: PrismaMock) => Promise<unknown>) => callback(prisma),
    );
    service = new InspectorsService(prisma as unknown as PrismaService, rules);
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

    it('envia ao inspectorProfile.create exatamente os campos do perfil mais o userId', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(null);
      prisma.inspectorProfile.create.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        ...dto,
        verified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: 'u1', name: 'João' },
      });

      await service.create('u1', dto);

      expect(prisma.inspectorProfile.create).toHaveBeenCalledTimes(1);
      expect(prisma.inspectorProfile.create).toHaveBeenCalledWith({
        data: {
          bio: 'Mecânico há 15 anos, especialista em câmbio.',
          specialties: ['ENGINE', 'BRAKES'],
          city: 'Barretos',
          state: 'SP',
          serviceRadiusKm: 30,
          basePriceCents: 15000,
          userId: 'u1',
        },
        include: { user: true },
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

  describe('preço mínimo no create', () => {
    it('lança BadRequestException quando basePriceCents está abaixo do mínimo e não cria o perfil', async () => {
      const promise = service.create('u1', { ...dto, basePriceCents: 4999 });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(
        'O preço base precisa ser de pelo menos 5000 centavos (R$ 50,00)',
      );
      expect(prisma.inspectorProfile.create).not.toHaveBeenCalled();
    });

    it('aceita basePriceCents igual ao mínimo', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(null);
      prisma.inspectorProfile.create.mockResolvedValue({
        id: 'p1',
        userId: 'u1',
        ...dto,
        basePriceCents: 5000,
        verified: false,
        user: { id: 'u1', name: 'João' },
      });

      await expect(service.create('u1', { ...dto, basePriceCents: 5000 })).resolves.toBeInstanceOf(
        InspectorResponseDto,
      );
    });
  });

  describe('preço mínimo no update', () => {
    const stored = {
      id: 'p1',
      userId: 'u1',
      ...dto,
      verified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('lança BadRequestException quando basePriceCents vem no corpo abaixo do mínimo e não atualiza', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(stored);

      const promise = service.update('u1', { basePriceCents: 100 });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(
        'O preço base precisa ser de pelo menos 5000 centavos (R$ 50,00)',
      );
      expect(prisma.inspectorProfile.update).not.toHaveBeenCalled();
    });

    it('não confere o preço quando basePriceCents não vem no corpo (perfil antigo abaixo do mínimo continua editável)', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue({ ...stored, basePriceCents: 1000 });
      prisma.inspectorProfile.update.mockResolvedValue({
        ...stored,
        basePriceCents: 1000,
        bio: 'Bio nova com mais de vinte caracteres.',
        user: { id: 'u1', name: 'João' },
      });

      await expect(
        service.update('u1', { bio: 'Bio nova com mais de vinte caracteres.' }),
      ).resolves.toBeInstanceOf(InspectorResponseDto);
    });
  });

  describe('update', () => {
    const existing = {
      id: 'p1',
      userId: 'u1',
      ...dto,
      verified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    function updatedProfile(changes: Partial<CreateInspectorProfileDto>) {
      return { ...existing, ...changes, user: { id: 'u1', name: 'João' } };
    }

    it('envia ao inspectorProfile.update todos os campos informados', async () => {
      const changes = {
        bio: 'Mecânico há 20 anos, especialista em suspensão.',
        specialties: ['SUSPENSION'],
        city: 'Ribeirão Preto',
        state: 'MG',
        serviceRadiusKm: 50,
        basePriceCents: 20000,
      } satisfies UpdateInspectorProfileDto;
      prisma.inspectorProfile.findUnique.mockResolvedValue(existing);
      prisma.inspectorProfile.update.mockResolvedValue(
        updatedProfile(changes),
      );

      await service.update('u1', changes);

      expect(prisma.inspectorProfile.update).toHaveBeenCalledTimes(1);
      expect(prisma.inspectorProfile.update).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: {
          bio: 'Mecânico há 20 anos, especialista em suspensão.',
          specialties: ['SUSPENSION'],
          city: 'Ribeirão Preto',
          state: 'MG',
          serviceRadiusKm: 50,
          basePriceCents: 20000,
        },
        include: { user: true },
      });
    });

    it('não altera os campos ausentes no update parcial', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(existing);
      prisma.inspectorProfile.update.mockResolvedValue(
        updatedProfile({ city: 'Ribeirão Preto' }),
      );

      await service.update('u1', { city: 'Ribeirão Preto' });

      const [{ data }] = prisma.inspectorProfile.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data.city).toBe('Ribeirão Preto');
      // Para o Prisma, undefined significa "não alterar este campo".
      for (const field of [
        'bio',
        'specialties',
        'state',
        'serviceRadiusKm',
        'basePriceCents',
      ]) {
        expect(data[field]).toBeUndefined();
      }
    });

    it('não repassa ao Prisma campos que não estão no DTO (ex.: verified, userId)', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(existing);
      prisma.inspectorProfile.update.mockResolvedValue(
        updatedProfile({ city: 'Ribeirão Preto' }),
      );
      const withExtras = {
        city: 'Ribeirão Preto',
        verified: true,
        userId: 'outro',
      } as UpdateInspectorProfileDto;

      await service.update('u1', withExtras);

      const [{ data }] = prisma.inspectorProfile.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(data).not.toHaveProperty('verified');
      expect(data).not.toHaveProperty('userId');
    });

    it('devolve o perfil atualizado como InspectorResponseDto', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(existing);
      prisma.inspectorProfile.update.mockResolvedValue(
        updatedProfile({ city: 'Ribeirão Preto' }),
      );

      const result = await service.update('u1', { city: 'Ribeirão Preto' });

      expect(result).toBeInstanceOf(InspectorResponseDto);
      expect(result).toEqual({
        id: 'p1',
        name: 'João',
        ...dto,
        city: 'Ribeirão Preto',
        verified: false,
      });
    });

    it('lança NotFoundException quando o usuário não tem perfil', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(null);

      const promise = service.update('u1', { city: 'Ribeirão Preto' });

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow(
        'Perfil de avaliador não encontrado',
      );
      expect(prisma.inspectorProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('findMine', () => {
    const profile = {
      id: 'p1',
      userId: 'u1',
      ...dto,
      verified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'u1',
        name: 'João',
        email: 'joao@x.com',
        passwordHash: 'hash',
      },
    };

    it('busca o perfil pelo userId incluindo o usuário', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(profile);

      await service.findMine('u1');

      expect(prisma.inspectorProfile.findUnique).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        include: { user: true },
      });
    });

    it('devolve o perfil como InspectorResponseDto sem dados sensíveis', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(profile);

      const result = await service.findMine('u1');

      expect(result).toBeInstanceOf(InspectorResponseDto);
      expect(result).toEqual({
        id: 'p1',
        name: 'João',
        ...dto,
        verified: true,
        platformFeeBps: 1000,
        estimatedPayoutCents: 13500,
      });
      expect(JSON.stringify(result)).not.toContain('passwordHash');
      expect(result).not.toHaveProperty('userId');
    });

    it('devolve MyInspectorProfileResponseDto com a comissão atual e o repasse estimado do preço base', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue({
        ...profile,
        basePriceCents: 12345,
      });

      const result = await service.findMine('u1');

      expect(result).toBeInstanceOf(MyInspectorProfileResponseDto);
      // 12345 com 1000 bps: comissão floor((12345*1000 + 5000)/10000) = 1235
      expect(result).toMatchObject({ platformFeeBps: 1000, estimatedPayoutCents: 11110 });
    });

    it('lança NotFoundException quando o usuário não tem perfil', async () => {
      prisma.inspectorProfile.findUnique.mockResolvedValue(null);

      const promise = service.findMine('u1');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow(
        'Perfil de avaliador não encontrado',
      );
    });
  });

  describe('findAllVerified', () => {
    function verifiedProfile(id: string, name: string) {
      return {
        id,
        userId: `u-${id}`,
        ...dto,
        verified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: { id: `u-${id}`, name, passwordHash: 'hash' },
      };
    }

    it('filtra por verified: true no where do findMany', async () => {
      prisma.inspectorProfile.findMany.mockResolvedValue([]);

      await service.findAllVerified();

      expect(prisma.inspectorProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { verified: true },
          include: { user: true },
        }),
      );
    });

    it('mapeia cada perfil para InspectorResponseDto', async () => {
      prisma.inspectorProfile.findMany.mockResolvedValue([
        verifiedProfile('p1', 'João'),
        verifiedProfile('p2', 'Ana'),
      ]);

      const result = await service.findAllVerified();

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(InspectorResponseDto);
      expect(result[1]).toBeInstanceOf(InspectorResponseDto);
      expect(result).toEqual([
        { id: 'p1', name: 'João', ...dto, verified: true },
        { id: 'p2', name: 'Ana', ...dto, verified: true },
      ]);
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('a lista pública não traz platformFeeBps nem estimatedPayoutCents', async () => {
      prisma.inspectorProfile.findMany.mockResolvedValue([
        { id: 'p1', userId: 'u1', ...dto, verified: true, user: { id: 'u1', name: 'João' } },
      ]);

      const [item] = await service.findAllVerified();

      expect(item).not.toBeInstanceOf(MyInspectorProfileResponseDto);
      expect(item).not.toHaveProperty('platformFeeBps');
      expect(item).not.toHaveProperty('estimatedPayoutCents');
    });

    it('devolve lista vazia quando não há perfis verificados', async () => {
      prisma.inspectorProfile.findMany.mockResolvedValue([]);

      await expect(service.findAllVerified()).resolves.toEqual([]);
    });
  });
});
