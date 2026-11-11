import { ListingResponseDto } from './listing-response.dto.js';
import { MyListingResponseDto } from './my-listing-response.dto.js';

const entity = {
  id: 'l1',
  sellerId: 'u1',
  title: 'Gol 1.0 2018 completo',
  description: 'Único dono, revisões em dia, pneus novos.',
  priceCents: 4500000,
  city: 'Boituva',
  state: 'SP',
  status: 'PAUSED' as const,
  createdAt: new Date('2026-11-10T12:00:00.000Z'),
  updatedAt: new Date('2026-11-10T12:00:00.000Z'),
  seller: { id: 'u1', name: 'Maria', email: 'maria@x.com', passwordHash: 'hash' },
  vehicle: {
    id: 'v1',
    listingId: 'l1',
    brand: 'Volkswagen',
    model: 'Gol',
    year: 2018,
    mileageKm: 68000,
    fuel: 'FLEX' as const,
    transmission: 'MANUAL' as const,
  },
};

const PUBLIC_KEYS = [
  'city',
  'createdAt',
  'description',
  'id',
  'priceCents',
  'sellerName',
  'state',
  'title',
  'vehicle',
];

describe('ListingResponseDto (resposta pública)', () => {
  it('tem exatamente os campos públicos: sem sellerId e sem status', () => {
    const dto = ListingResponseDto.from(entity);

    expect(Object.keys(dto).sort()).toEqual(PUBLIC_KEYS);
  });

  it('não expõe dados do vendedor além do nome', () => {
    const json = JSON.stringify(ListingResponseDto.from(entity));

    expect(json).not.toContain('passwordHash');
    expect(json).not.toContain('maria@x.com');
    expect(json).not.toContain('"u1"');
  });

  it('copia o veículo campo a campo, sem id nem listingId', () => {
    const dto = ListingResponseDto.from(entity);

    expect(dto.vehicle).toEqual({
      brand: 'Volkswagen',
      model: 'Gol',
      year: 2018,
      mileageKm: 68000,
      fuel: 'FLEX',
      transmission: 'MANUAL',
    });
  });
});

describe('MyListingResponseDto (resposta do dono)', () => {
  it('tem os campos públicos mais status, e continua sem sellerId', () => {
    const dto = MyListingResponseDto.from(entity);

    expect(dto).toBeInstanceOf(MyListingResponseDto);
    expect(Object.keys(dto).sort()).toEqual([...PUBLIC_KEYS, 'status'].sort());
    expect(dto.status).toBe('PAUSED');
  });
});
