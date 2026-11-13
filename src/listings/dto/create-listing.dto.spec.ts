import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ValidationError } from 'class-validator';
import { CreateListingDto } from './create-listing.dto.js';

const vehicle = {
  brand: 'Volkswagen',
  model: 'Gol',
  year: 2018,
  mileageKm: 68_000,
  fuel: 'FLEX',
  transmission: 'MANUAL',
};

const valid = {
  title: 'Gol 1.0 2018 completo',
  description: 'Único dono, revisões em dia, pneus novos.',
  priceCents: 4_500_000,
  city: 'Boituva',
  state: 'SP',
  vehicle,
};

// Mesmas opções do ValidationPipe global (src/app.setup.ts).
async function errorsFor(body: Record<string, unknown>): Promise<ValidationError[]> {
  return validate(plainToInstance(CreateListingDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

/** Caminho e regra de cada erro, inclusive os do veículo (aninhado). */
function flatten(errors: ValidationError[], prefix = ''): string[] {
  return errors.flatMap((e) => [
    ...Object.keys(e.constraints ?? {}).map((c) => `${prefix}${e.property}:${c}`),
    ...flatten(e.children ?? [], `${prefix}${e.property}.`),
  ]);
}

describe('CreateListingDto (limites de entrada)', () => {
  it('aceita o payload válido', async () => {
    expect(await errorsFor(valid)).toEqual([]);
  });

  it.each([
    ['title', 120],
    ['description', 2000],
    ['city', 100],
  ])('aceita %s com exatamente %i caracteres', async (field, max) => {
    expect(await errorsFor({ ...valid, [field]: 'a'.repeat(max) })).toEqual([]);
  });

  it.each([
    ['title', 121],
    ['description', 2001],
    ['city', 101],
  ])('rejeita %s com %i caracteres', async (field, length) => {
    const errors = await errorsFor({ ...valid, [field]: 'a'.repeat(length) });

    expect(flatten(errors)).toEqual([`${field}:maxLength`]);
  });

  it('aceita priceCents = 1.000.000.000 (R$ 10 milhões)', async () => {
    expect(await errorsFor({ ...valid, priceCents: 1_000_000_000 })).toEqual([]);
  });

  it('rejeita priceCents = 1.000.000.001', async () => {
    const errors = await errorsFor({ ...valid, priceCents: 1_000_000_001 });

    expect(flatten(errors)).toEqual(['priceCents:max']);
  });

  it.each([
    ['brand', 100],
    ['model', 100],
  ])('aceita vehicle.%s com exatamente %i caracteres', async (field, max) => {
    const body = { ...valid, vehicle: { ...vehicle, [field]: 'a'.repeat(max) } };

    expect(await errorsFor(body)).toEqual([]);
  });

  it.each([
    ['brand', 101],
    ['model', 101],
  ])('rejeita vehicle.%s com %i caracteres', async (field, length) => {
    const body = { ...valid, vehicle: { ...vehicle, [field]: 'a'.repeat(length) } };

    expect(flatten(await errorsFor(body))).toEqual([`vehicle.${field}:maxLength`]);
  });

  it('aceita vehicle.mileageKm = 2.000.000', async () => {
    const body = { ...valid, vehicle: { ...vehicle, mileageKm: 2_000_000 } };

    expect(await errorsFor(body)).toEqual([]);
  });

  it('rejeita vehicle.mileageKm = 2.000.001', async () => {
    const body = { ...valid, vehicle: { ...vehicle, mileageKm: 2_000_001 } };

    expect(flatten(await errorsFor(body))).toEqual(['vehicle.mileageKm:max']);
  });
});
