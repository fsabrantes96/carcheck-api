import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInspectorProfileDto } from '../../inspectors/dto/create-inspector-profile.dto.js';
import { UpdateInspectorProfileDto } from '../../inspectors/dto/update-inspector-profile.dto.js';
import { CreateListingDto } from '../../listings/dto/create-listing.dto.js';
import { ListListingsQueryDto } from '../../listings/dto/list-listings-query.dto.js';
import { UpdateListingDto } from '../../listings/dto/update-listing.dto.js';

/** As 27 unidades federativas (26 estados e o Distrito Federal). */
const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const listing = {
  title: 'Gol 1.0 2018 completo',
  description: 'Único dono, revisões em dia, pneus novos.',
  priceCents: 4_500_000,
  city: 'Boituva',
  vehicle: {
    brand: 'Volkswagen',
    model: 'Gol',
    year: 2018,
    mileageKm: 68_000,
    fuel: 'FLEX',
    transmission: 'MANUAL',
  },
};

const profile = {
  bio: 'Mecânico há 15 anos, especialista em câmbio automático.',
  specialties: ['ENGINE'],
  city: 'Barretos',
  serviceRadiusKm: 30,
  basePriceCents: 15000,
};

// [nome, classe, corpo sem state]
const DTOS = [
  ['CreateListingDto', CreateListingDto, listing],
  ['UpdateListingDto', UpdateListingDto, {}],
  ['CreateInspectorProfileDto', CreateInspectorProfileDto, profile],
  ['UpdateInspectorProfileDto', UpdateInspectorProfileDto, {}],
  ['ListListingsQueryDto', ListListingsQueryDto, {}],
] as const;

async function check(
  cls: (typeof DTOS)[number][1],
  base: object,
  state: unknown,
) {
  const dto = plainToInstance(cls as new () => object, { ...base, state }) as {
    state?: unknown;
  };
  const errors = await validate(dto);
  return { dto, errors };
}

describe('state: sigla de uma das 27 UFs', () => {
  it('a lista do teste tem 27 siglas distintas', () => {
    expect(new Set(UFS).size).toBe(27);
  });

  describe.each(DTOS)('%s', (_name, cls, base) => {
    it.each(UFS)('aceita %s', async (uf) => {
      const { errors } = await check(cls, base, uf);

      expect(errors).toEqual([]);
    });

    it.each([
      [' sp ', 'SP'],
      ['rj', 'RJ'],
      ['Mg', 'MG'],
    ])('normaliza %o para %s (trim e maiúsculas)', async (input, expected) => {
      const { dto, errors } = await check(cls, base, input);

      expect(errors).toEqual([]);
      expect(dto.state).toBe(expected);
    });

    it.each([
      ['XX'],
      ['12'],
      ['S️P️'],
      ['SPP'],
      [''],
      ['São Paulo'],
    ])('recusa %o com o erro de state', async (input) => {
      const { errors } = await check(cls, base, input);

      expect(errors.map((e) => e.property)).toEqual(['state']);
      expect(errors[0].constraints).toHaveProperty('isIn');
    });

    it('recusa state que não é texto sem tentar transformá-lo', async () => {
      const { dto, errors } = await check(cls, base, 35);

      expect(dto.state).toBe(35);
      expect(errors.map((e) => e.property)).toEqual(['state']);
    });
  });
});
