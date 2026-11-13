import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListListingsQueryDto } from './list-listings-query.dto.js';

// Query string chega como texto; mesmas opções do ValidationPipe global.
async function errorsFor(query: Record<string, string>): Promise<string[]> {
  const errors = await validate(plainToInstance(ListListingsQueryDto, query), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((e) => Object.keys(e.constraints ?? {}).map((c) => `${e.property}:${c}`));
}

const nextYear = new Date().getFullYear() + 1;

describe('ListListingsQueryDto (limites de entrada)', () => {
  it.each(['brand', 'city'])('aceita %s com 100 caracteres', async (field) => {
    expect(await errorsFor({ [field]: 'a'.repeat(100) })).toEqual([]);
  });

  it.each(['brand', 'city'])('rejeita %s com 101 caracteres', async (field) => {
    expect(await errorsFor({ [field]: 'a'.repeat(101) })).toEqual([`${field}:maxLength`]);
  });

  it.each(['minPriceCents', 'maxPriceCents'])('aceita %s = 1000000000', async (field) => {
    expect(await errorsFor({ [field]: '1000000000' })).toEqual([]);
  });

  it.each(['minPriceCents', 'maxPriceCents'])('rejeita %s = 1000000001', async (field) => {
    expect(await errorsFor({ [field]: '1000000001' })).toEqual([`${field}:max`]);
  });

  it.each(['minYear', 'maxYear'])('aceita %s = 1950', async (field) => {
    expect(await errorsFor({ [field]: '1950' })).toEqual([]);
  });

  it.each(['minYear', 'maxYear'])('aceita %s = ano que vem', async (field) => {
    expect(await errorsFor({ [field]: String(nextYear) })).toEqual([]);
  });

  it.each(['minYear', 'maxYear'])('rejeita %s = 1949', async (field) => {
    expect(await errorsFor({ [field]: '1949' })).toEqual([`${field}:min`]);
  });

  it.each(['minYear', 'maxYear'])('rejeita %s depois do ano que vem', async (field) => {
    expect(await errorsFor({ [field]: String(nextYear + 1) })).toEqual([`${field}:max`]);
  });

  it('aceita page = 200 (200 × limit máximo 50 = 10.000 registros pulados)', async () => {
    expect(await errorsFor({ page: '200' })).toEqual([]);
  });

  it.each(['201', '1e20'])('rejeita page = %s', async (page) => {
    expect(await errorsFor({ page })).toEqual(['page:max']);
  });
});
