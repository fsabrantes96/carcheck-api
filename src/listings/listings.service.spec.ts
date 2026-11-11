import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FakeClock } from '../../test/support/fake-clock.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CreateListingDto } from './dto/create-listing.dto.js';
import { ListListingsQueryDto } from './dto/list-listings-query.dto.js';
import { ListingResponseDto } from './dto/listing-response.dto.js';
import { MyListingResponseDto } from './dto/my-listing-response.dto.js';
import type { UpdateListingDto } from './dto/update-listing.dto.js';
import type { VehicleDto } from './dto/vehicle.dto.js';
import { ListingsService } from './listings.service.js';

const vehicle = {
  brand: 'Volkswagen',
  model: 'Gol',
  year: 2018,
  mileageKm: 68000,
  fuel: 'FLEX',
  transmission: 'MANUAL',
} satisfies VehicleDto;

const createDto = {
  title: 'Gol 1.0 2018 completo',
  description: 'Único dono, revisões em dia, pneus novos.',
  priceCents: 4500000,
  city: 'Boituva',
  state: 'SP',
  vehicle,
} satisfies CreateListingDto;

// O cast representa o body de um PATCH e permite simular campos que o DTO não
// declara (ex.: `status`, que saiu do UpdateListingDto).
function updateDto(
  body: Partial<UpdateListingDto> & Record<string, unknown>,
): UpdateListingDto {
  return body as UpdateListingDto;
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('erro do prisma', {
    code,
    clientVersion: 'test',
  });
}

function listingEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    sellerId: 'u1',
    title: createDto.title,
    description: createDto.description,
    priceCents: createDto.priceCents,
    city: createDto.city,
    state: createDto.state,
    status: 'ACTIVE',
    createdAt: new Date('2026-11-10T12:00:00.000Z'),
    updatedAt: new Date('2026-11-10T12:00:00.000Z'),
    seller: { id: 'u1', name: 'Maria', passwordHash: 'hash' },
    vehicle: { id: 'v1', listingId: 'l1', ...vehicle },
    ...overrides,
  };
}

type PrismaMock = {
  listing: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  appointment: {
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

// Instancia o DTO de verdade para herdar os defaults (page = 1, limit = 20),
// como faz o ValidationPipe com transform.
function query(params: Partial<ListListingsQueryDto> = {}): ListListingsQueryDto {
  return Object.assign(new ListListingsQueryDto(), params);
}

describe('ListingsService', () => {
  let prisma: PrismaMock;
  let service: ListingsService;

  beforeEach(() => {
    prisma = {
      listing: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
      appointment: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn(),
    };
    // Forma de array: as "queries" já são as promises devolvidas pelos mocks.
    // Forma com callback (transação interativa): chama com o próprio mock.
    prisma.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: PrismaMock) => Promise<unknown>)(prisma)
        : Promise.all(arg as Promise<unknown>[]),
    );
    service = new ListingsService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('envia ao listing.create exatamente os campos do anúncio, o sellerId e o veículo aninhado', async () => {
      prisma.listing.create.mockResolvedValue(listingEntity());

      await service.create('u1', createDto);

      expect(prisma.listing.create).toHaveBeenCalledTimes(1);
      expect(prisma.listing.create).toHaveBeenCalledWith({
        data: {
          title: 'Gol 1.0 2018 completo',
          description: 'Único dono, revisões em dia, pneus novos.',
          priceCents: 4500000,
          city: 'Boituva',
          state: 'SP',
          sellerId: 'u1',
          vehicle: {
            create: {
              brand: 'Volkswagen',
              model: 'Gol',
              year: 2018,
              mileageKm: 68000,
              fuel: 'FLEX',
              transmission: 'MANUAL',
            },
          },
        },
        include: { seller: true, vehicle: true },
      });
    });

    it('devolve o MyListingResponseDto do dono, com status e sem sellerId nem dados sensíveis', async () => {
      prisma.listing.create.mockResolvedValue(listingEntity());

      const result = await service.create('u1', createDto);

      expect(result).toBeInstanceOf(MyListingResponseDto);
      expect(result).toEqual({
        id: 'l1',
        sellerName: 'Maria',
        title: createDto.title,
        description: createDto.description,
        priceCents: createDto.priceCents,
        city: createDto.city,
        state: createDto.state,
        status: 'ACTIVE',
        vehicle,
        createdAt: new Date('2026-11-10T12:00:00.000Z'),
      });
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });
  });

  describe('update', () => {
    function updateData(): Record<string, unknown> {
      const [args] = prisma.listing.update.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      return args.data;
    }

    beforeEach(() => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1' });
      prisma.listing.update.mockResolvedValue(listingEntity());
    });

    it('confere o dono buscando só o sellerId do anúncio', async () => {
      await service.update('l1', 'u1', updateDto({ priceCents: 5000000 }));

      expect(prisma.listing.findUnique).toHaveBeenCalledWith({
        where: { id: 'l1' },
        select: { sellerId: true },
      });
    });

    it('lança NotFoundException quando o anúncio não existe', async () => {
      prisma.listing.findUnique.mockResolvedValue(null);

      const promise = service.update('l1', 'u1', updateDto({ priceCents: 1 }));

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Anúncio não encontrado');
      expect(prisma.listing.update).not.toHaveBeenCalled();
    });

    it('lança ForbiddenException quando o anúncio é de outro usuário', async () => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'outro' });

      const promise = service.update('l1', 'u1', updateDto({ priceCents: 1 }));

      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toThrow('Este anúncio não pertence a você');
      expect(prisma.listing.update).not.toHaveBeenCalled();
    });

    it('envia where pelo id, sem anúncios arquivados, e include com seller e vehicle', async () => {
      await service.update('l1', 'u1', updateDto({ priceCents: 5000000 }));

      expect(prisma.listing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'l1', status: { not: 'ARCHIVED' } },
          include: { seller: true, vehicle: true },
        }),
      );
    });

    // toEqual ignora chaves com valor undefined, assim como o Prisma: um
    // mapeamento campo a campo que gere { title: undefined, ... } continua
    // equivalente a { priceCents }.
    it('no update parcial só com priceCents envia data equivalente a { priceCents } (chaves undefined contam como ausentes)', async () => {
      await service.update('l1', 'u1', updateDto({ priceCents: 5000000 }));

      expect(updateData()).toEqual({ priceCents: 5000000 });
    });

    it('não envia status ao Prisma mesmo que o body traga (o campo saiu do DTO)', async () => {
      await service.update('l1', 'u1', updateDto({ status: 'SOLD' }));

      expect(updateData()).toEqual({});
    });

    it('lança ConflictException quando o anúncio está arquivado', async () => {
      prisma.listing.findUnique
        .mockResolvedValueOnce({ sellerId: 'u1' })
        .mockResolvedValueOnce({ status: 'ARCHIVED' });
      prisma.listing.update.mockRejectedValue(prismaError('P2025'));

      const promise = service.update('l1', 'u1', updateDto({ priceCents: 1 }));

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow('Anúncio arquivado não pode ser alterado');
    });

    it('repassa o erro original quando o update falha com P2025 e o anúncio não está arquivado', async () => {
      const original = prismaError('P2025');
      prisma.listing.findUnique
        .mockResolvedValueOnce({ sellerId: 'u1' })
        .mockResolvedValueOnce({ status: 'ACTIVE' });
      prisma.listing.update.mockRejectedValue(original);

      const promise = service.update('l1', 'u1', updateDto({ priceCents: 1 }));

      await expect(promise).rejects.toBe(original);
    });

    it('com vehicle completo envia data.vehicle = { update: campos do veículo }', async () => {
      await service.update('l1', 'u1', updateDto({ vehicle }));

      expect(updateData().vehicle).toEqual({
        update: {
          brand: 'Volkswagen',
          model: 'Gol',
          year: 2018,
          mileageKm: 68000,
          fuel: 'FLEX',
          transmission: 'MANUAL',
        },
      });
    });

    it('sem vehicle no body, data não tem a chave vehicle definida', async () => {
      await service.update(
        'l1',
        'u1',
        updateDto({ title: 'Novo título do anúncio' }),
      );

      expect(updateData().vehicle).toBeUndefined();
    });

    it('devolve o ListingResponseDto', async () => {
      const result = await service.update(
        'l1',
        'u1',
        updateDto({ priceCents: 5000000 }),
      );

      expect(result).toBeInstanceOf(ListingResponseDto);
      expect(result.id).toBe('l1');
    });
  });

  describe('findAll', () => {
    type FindManyArgs = {
      where: Record<string, unknown>;
      skip: number;
      take: number;
      orderBy: unknown;
      include: unknown;
    };

    function findManyArgs(): FindManyArgs {
      const [args] = prisma.listing.findMany.mock.calls[0] as [FindManyArgs];
      return args;
    }

    beforeEach(() => {
      prisma.listing.findMany.mockResolvedValue([]);
      prisma.listing.count.mockResolvedValue(0);
    });

    it('sem filtros usa where só com status ACTIVE', async () => {
      await service.findAll(query());

      expect(findManyArgs().where).toEqual({ status: 'ACTIVE' });
    });

    it('mantém status ACTIVE no where mesmo com todos os filtros', async () => {
      await service.findAll(
        query({
          brand: 'vw',
          city: 'boituva',
          state: 'sp',
          minPriceCents: 1,
          maxPriceCents: 2,
          minYear: 2010,
          maxYear: 2020,
        }),
      );

      expect(findManyArgs().where.status).toBe('ACTIVE');
    });

    it('filtra a marca do veículo com mode insensitive', async () => {
      await service.findAll(query({ brand: 'volkswagen' }));

      expect(findManyArgs().where).toEqual({
        status: 'ACTIVE',
        vehicle: {
          is: { brand: { equals: 'volkswagen', mode: 'insensitive' } },
        },
      });
    });

    it('filtra a cidade com mode insensitive', async () => {
      await service.findAll(query({ city: 'boituva' }));

      expect(findManyArgs().where).toEqual({
        status: 'ACTIVE',
        city: { equals: 'boituva', mode: 'insensitive' },
      });
    });

    it('converte o estado para maiúsculas', async () => {
      await service.findAll(query({ state: 'sp' }));

      expect(findManyArgs().where).toEqual({ status: 'ACTIVE', state: 'SP' });
    });

    it('filtra a faixa de preço com gte e lte', async () => {
      await service.findAll(
        query({ minPriceCents: 1000000, maxPriceCents: 5000000 }),
      );

      expect(findManyArgs().where).toEqual({
        status: 'ACTIVE',
        priceCents: { gte: 1000000, lte: 5000000 },
      });
    });

    it('aceita só o preço mínimo (lte fica undefined)', async () => {
      await service.findAll(query({ minPriceCents: 1000000 }));

      expect(findManyArgs().where.priceCents).toEqual({
        gte: 1000000,
        lte: undefined,
      });
    });

    it('trata preço mínimo 0 como filtro (não como ausente)', async () => {
      await service.findAll(query({ minPriceCents: 0 }));

      expect(findManyArgs().where).toHaveProperty('priceCents.gte', 0);
    });

    it('filtra a faixa de ano do veículo com gte e lte', async () => {
      await service.findAll(query({ minYear: 2015, maxYear: 2022 }));

      expect(findManyArgs().where).toEqual({
        status: 'ACTIVE',
        vehicle: { is: { year: { gte: 2015, lte: 2022 } } },
      });
    });

    it('combina marca e ano no mesmo filtro de veículo', async () => {
      await service.findAll(query({ brand: 'gm', minYear: 2015 }));

      expect(findManyArgs().where.vehicle).toEqual({
        is: {
          brand: { equals: 'gm', mode: 'insensitive' },
          year: { gte: 2015, lte: undefined },
        },
      });
    });

    it('usa skip = (page - 1) * limit e take = limit', async () => {
      await service.findAll(query({ page: 3, limit: 10 }));

      expect(findManyArgs()).toEqual(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('com os defaults do DTO usa skip 0 e take 20', async () => {
      await service.findAll(query());

      expect(findManyArgs()).toEqual(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('ordena por createdAt desc e inclui seller e vehicle', async () => {
      await service.findAll(query());

      expect(findManyArgs()).toEqual(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          include: { seller: true, vehicle: true },
        }),
      );
    });

    it('conta com o mesmo where do findMany', async () => {
      await service.findAll(query({ city: 'boituva', state: 'sp' }));

      expect(prisma.listing.count).toHaveBeenCalledWith({
        where: findManyArgs().where,
      });
    });

    it('executa findMany e count em um único $transaction', async () => {
      await service.findAll(query());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('devolve { items, total, page, limit } com os itens como ListingResponseDto', async () => {
      prisma.listing.findMany.mockResolvedValue([
        listingEntity(),
        listingEntity({ id: 'l2' }),
      ]);
      prisma.listing.count.mockResolvedValue(42);

      const result = await service.findAll(query({ page: 2, limit: 2 }));

      expect(result).toEqual({
        items: [expect.any(ListingResponseDto), expect.any(ListingResponseDto)],
        total: 42,
        page: 2,
        limit: 2,
      });
      expect(result.items.map((item) => item.id)).toEqual(['l1', 'l2']);
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });
  });

  describe('findOnePublic', () => {
    it('busca pelo id com status ACTIVE no where', async () => {
      prisma.listing.findFirst.mockResolvedValue(listingEntity());

      await service.findOnePublic('l1');

      expect(prisma.listing.findFirst).toHaveBeenCalledWith({
        where: { id: 'l1', status: 'ACTIVE' },
        include: { seller: true, vehicle: true },
      });
    });

    it('devolve o anúncio como ListingResponseDto', async () => {
      prisma.listing.findFirst.mockResolvedValue(listingEntity());

      const result = await service.findOnePublic('l1');

      expect(result).toBeInstanceOf(ListingResponseDto);
      expect(result.id).toBe('l1');
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('a resposta pública não tem sellerId nem status', async () => {
      prisma.listing.findFirst.mockResolvedValue(listingEntity());

      const result = await service.findOnePublic('l1');

      expect(result).not.toBeInstanceOf(MyListingResponseDto);
      expect(result).not.toHaveProperty('sellerId');
      expect(result).not.toHaveProperty('status');
    });

    it('lança NotFoundException quando o anúncio não existe ou não está ACTIVE', async () => {
      prisma.listing.findFirst.mockResolvedValue(null);

      const promise = service.findOnePublic('l1');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Anúncio não encontrado');
    });
  });

  describe('findMine', () => {
    it('busca os anúncios pelo sellerId, sem os arquivados', async () => {
      prisma.listing.findMany.mockResolvedValue([]);

      await service.findMine('u1');

      expect(prisma.listing.findMany).toHaveBeenCalledWith({
        where: { sellerId: 'u1', status: { not: 'ARCHIVED' } },
        include: { seller: true, vehicle: true },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('mapeia cada anúncio para ListingResponseDto', async () => {
      prisma.listing.findMany.mockResolvedValue([
        listingEntity(),
        listingEntity({ id: 'l2', status: 'PAUSED' }),
      ]);

      const result = await service.findMine('u1');

      expect(result).toEqual([
        expect.any(ListingResponseDto),
        expect.any(ListingResponseDto),
      ]);
      expect(result.map((item) => item.id)).toEqual(['l1', 'l2']);
    });
  });

  describe('pause, activate e markSold', () => {
    // [método, status de partida válido, status de chegada, status inválido]
    const cases = [
      ['pause', 'ACTIVE', 'PAUSED', 'SOLD'],
      ['activate', 'PAUSED', 'ACTIVE', 'ACTIVE'],
      ['markSold', 'ACTIVE', 'SOLD', 'ARCHIVED'],
    ] as const;

    it.each(cases)(
      '%s lança NotFoundException quando o anúncio não existe',
      async (method) => {
        prisma.listing.findUnique.mockResolvedValue(null);

        const promise = service[method]('l1', 'u1');

        await expect(promise).rejects.toBeInstanceOf(NotFoundException);
        await expect(promise).rejects.toThrow('Anúncio não encontrado');
        expect(prisma.listing.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each(cases)(
      '%s lança ForbiddenException quando o anúncio é de outro usuário',
      async (method, from) => {
        prisma.listing.findUnique.mockResolvedValue({ sellerId: 'outro', status: from });

        const promise = service[method]('l1', 'u1');

        await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
        await expect(promise).rejects.toThrow('Este anúncio não pertence a você');
        expect(prisma.listing.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each(cases)(
      '%s lança ConflictException quando a ação não é permitida no status atual',
      async (method, _from, _to, invalid) => {
        prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: invalid });

        const promise = service[method]('l1', 'u1');

        await expect(promise).rejects.toBeInstanceOf(ConflictException);
        await expect(promise).rejects.toThrow(
          'Ação não permitida no status atual do anúncio',
        );
        expect(prisma.listing.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each(cases)(
      '%s lança ConflictException quando outra requisição muda o status antes da gravação',
      async (method, from) => {
        prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: from });
        prisma.listing.updateMany.mockResolvedValue({ count: 0 });

        const promise = service[method]('l1', 'u1');

        await expect(promise).rejects.toBeInstanceOf(ConflictException);
        await expect(promise).rejects.toThrow(
          'O anúncio mudou de status; recarregue e tente novamente',
        );
        expect(prisma.listing.findUniqueOrThrow).not.toHaveBeenCalled();
      },
    );

    it.each(cases)(
      '%s grava com updateMany filtrando pelo dono e pelo status lido (%s → %s)',
      async (method, from, to) => {
        prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: from });
        prisma.listing.updateMany.mockResolvedValue({ count: 1 });
        prisma.listing.findUniqueOrThrow.mockResolvedValue(listingEntity({ status: to }));

        await service[method]('l1', 'u1');

        expect(prisma.listing.findUnique).toHaveBeenCalledWith({
          where: { id: 'l1' },
          select: { sellerId: true, status: true },
        });
        expect(prisma.listing.updateMany).toHaveBeenCalledWith({
          where: { id: 'l1', sellerId: 'u1', status: from },
          data: { status: to },
        });
      },
    );

    it.each(cases)(
      '%s devolve o anúncio atualizado como ListingResponseDto',
      async (method, from, to) => {
        prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: from });
        prisma.listing.updateMany.mockResolvedValue({ count: 1 });
        prisma.listing.findUniqueOrThrow.mockResolvedValue(listingEntity({ status: to }));

        const result = await service[method]('l1', 'u1');

        expect(prisma.listing.findUniqueOrThrow).toHaveBeenCalledWith({
          where: { id: 'l1' },
          include: { seller: true, vehicle: true },
        });
        expect(result).toBeInstanceOf(ListingResponseDto);
        expect(result.status).toBe(to);
        expect(JSON.stringify(result)).not.toContain('passwordHash');
      },
    );
  });

  describe('saída de ACTIVE com agendamentos em aberto', () => {
    const NOW = new Date('2030-01-01T12:00:00.000Z');

    beforeEach(() => {
      service = new ListingsService(prisma as unknown as PrismaService, new FakeClock(NOW));
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: 'ACTIVE' });
      prisma.listing.updateMany.mockResolvedValue({ count: 1 });
      prisma.listing.findUniqueOrThrow.mockResolvedValue(listingEntity());
    });

    const leaving = [
      ['pause', (s: ListingsService) => s.pause('l1', 'u1')],
      ['markSold', (s: ListingsService) => s.markSold('l1', 'u1')],
      ['remove (arquivar)', (s: ListingsService) => s.remove('l1', 'u1')],
    ] as const;

    it.each(leaving)(
      '%s cancela os agendamentos REQUESTED, ACCEPTED e AWAITING_PAYMENT do anúncio (CANCELLED, endedBy SELLER)',
      async (_name, run) => {
        await run(service);

        expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
          where: { listingId: 'l1', status: { in: ['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] } },
          data: { status: 'CANCELLED', endedBy: 'SELLER', endedAt: NOW },
        });
      },
    );

    it.each(leaving)(
      '%s faz tudo numa transação, com o UPDATE do anúncio antes de mexer nos agendamentos',
      async (_name, run) => {
        await run(service);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        const listingUpdate = prisma.listing.updateMany.mock.invocationCallOrder[0];
        expect(listingUpdate).toBeLessThan(prisma.appointment.findFirst.mock.invocationCallOrder[0]);
        expect(listingUpdate).toBeLessThan(prisma.appointment.updateMany.mock.invocationCallOrder[0]);
      },
    );

    it.each(leaving)(
      '%s responde 409 e não cancela nada quando existe agendamento PAID',
      async (_name, run) => {
        prisma.appointment.findFirst.mockResolvedValue({ id: 'pago' });

        const promise = run(service);

        await expect(promise).rejects.toBeInstanceOf(ConflictException);
        await expect(promise).rejects.toThrow(
          'O anúncio tem avaliação paga em andamento e não pode sair de ACTIVE',
        );
        expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
          where: { listingId: 'l1', status: 'PAID' },
          select: { id: true },
        });
        expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
      },
    );

    it('activate (PAUSED → ACTIVE) não mexe em agendamentos', async () => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: 'PAUSED' });

      await service.activate('l1', 'u1');

      expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
      expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
    });

    it('não mexe em agendamentos quando a transição é inválida (409 antes da transação)', async () => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: 'ARCHIVED' });

      const promise = service.pause('l1', 'u1');

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow('Ação não permitida no status atual do anúncio');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('respostas do dono', () => {
    it('findMine devolve MyListingResponseDto com status e sem sellerId', async () => {
      prisma.listing.findMany.mockResolvedValue([
        listingEntity({ status: 'PAUSED' }),
      ]);

      const [item] = await service.findMine('u1');

      expect(item).toBeInstanceOf(MyListingResponseDto);
      expect(item.status).toBe('PAUSED');
      expect(item).not.toHaveProperty('sellerId');
    });

    it('findAll devolve itens públicos, sem sellerId nem status', async () => {
      prisma.listing.findMany.mockResolvedValue([listingEntity()]);
      prisma.listing.count.mockResolvedValue(1);

      const { items } = await service.findAll(query());

      expect(items[0]).not.toBeInstanceOf(MyListingResponseDto);
      expect(items[0]).not.toHaveProperty('sellerId');
      expect(items[0]).not.toHaveProperty('status');
    });

    it('update devolve MyListingResponseDto', async () => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1' });
      prisma.listing.update.mockResolvedValue(listingEntity());

      const result = await service.update('l1', 'u1', updateDto({ priceCents: 1 }));

      expect(result).toBeInstanceOf(MyListingResponseDto);
      expect(result).not.toHaveProperty('sellerId');
    });

    it.each([
      ['pause', 'ACTIVE'],
      ['activate', 'PAUSED'],
      ['markSold', 'ACTIVE'],
    ] as const)('%s devolve MyListingResponseDto', async (method, from) => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: from });
      prisma.listing.updateMany.mockResolvedValue({ count: 1 });
      prisma.listing.findUniqueOrThrow.mockResolvedValue(listingEntity());

      const result = await service[method]('l1', 'u1');

      expect(result).toBeInstanceOf(MyListingResponseDto);
      expect(result).not.toHaveProperty('sellerId');
    });
  });

  describe('remove', () => {
    it('lança NotFoundException e não chama delete quando o anúncio não existe', async () => {
      prisma.listing.findUnique.mockResolvedValue(null);

      const promise = service.remove('l1', 'u1');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toThrow('Anúncio não encontrado');
      expect(prisma.listing.delete).not.toHaveBeenCalled();
    });

    it('lança ForbiddenException e não chama delete quando o anúncio é de outro usuário', async () => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'outro' });

      const promise = service.remove('l1', 'u1');

      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toThrow('Este anúncio não pertence a você');
      expect(prisma.listing.delete).not.toHaveBeenCalled();
    });

    it('arquiva o anúncio (status ARCHIVED) em vez de apagar quando o usuário é o dono', async () => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: 'ACTIVE' });
      prisma.listing.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.remove('l1', 'u1')).resolves.toBeUndefined();
      expect(prisma.listing.updateMany).toHaveBeenCalledWith({
        where: { id: 'l1', sellerId: 'u1', status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      });
      expect(prisma.listing.delete).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando o anúncio já está arquivado', async () => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: 'ARCHIVED' });

      const promise = service.remove('l1', 'u1');

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow(
        'Ação não permitida no status atual do anúncio',
      );
      expect(prisma.listing.updateMany).not.toHaveBeenCalled();
    });

    it('lança ConflictException quando outra requisição muda o status antes da gravação', async () => {
      prisma.listing.findUnique.mockResolvedValue({ sellerId: 'u1', status: 'ACTIVE' });
      prisma.listing.updateMany.mockResolvedValue({ count: 0 });

      const promise = service.remove('l1', 'u1');

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow(
        'O anúncio mudou de status; recarregue e tente novamente',
      );
    });
  });
});
