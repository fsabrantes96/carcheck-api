import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CreateListingDto } from './dto/create-listing.dto.js';
import { ListingResponseDto } from './dto/listing-response.dto.js';
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

// UpdateListingDto declara `status` sem `?` (embora tenha @IsOptional), então
// um literal parcial não satisfaz o tipo; o cast representa o body de um PATCH.
function updateDto(body: Partial<UpdateListingDto>): UpdateListingDto {
  return body as UpdateListingDto;
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
    update: ReturnType<typeof vi.fn>;
  };
};

describe('ListingsService', () => {
  let prisma: PrismaMock;
  let service: ListingsService;

  beforeEach(() => {
    prisma = {
      listing: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    };
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

    it('devolve o ListingResponseDto sem dados sensíveis do vendedor', async () => {
      prisma.listing.create.mockResolvedValue(listingEntity());

      const result = await service.create('u1', createDto);

      expect(result).toBeInstanceOf(ListingResponseDto);
      expect(result).toEqual({
        id: 'l1',
        sellerId: 'u1',
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

    it('envia where pelo id e include com seller e vehicle', async () => {
      await service.update('l1', 'u1', updateDto({ priceCents: 5000000 }));

      expect(prisma.listing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'l1' },
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

    it('repassa o status quando ele vem no body', async () => {
      await service.update('l1', 'u1', updateDto({ status: 'SOLD' }));

      expect(updateData()).toEqual({ status: 'SOLD' });
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
});
