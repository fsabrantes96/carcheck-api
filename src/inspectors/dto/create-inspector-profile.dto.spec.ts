import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateInspectorProfileDto } from './create-inspector-profile.dto.js';
import { UpdateInspectorProfileDto } from './update-inspector-profile.dto.js';

const valid = {
  bio: 'Mecânico há 15 anos, especialista em câmbio.',
  specialties: ['ENGINE'],
  city: 'Barretos',
  state: 'SP',
  serviceRadiusKm: 30,
  basePriceCents: 15000,
};

// Mesmas opções do ValidationPipe global (src/app.setup.ts).
async function errorsFor(
  cls: typeof CreateInspectorProfileDto | typeof UpdateInspectorProfileDto,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((e) => Object.keys(e.constraints ?? {}).map((c) => `${e.property}:${c}`));
}

describe('CreateInspectorProfileDto (limites de entrada)', () => {
  it.each([
    ['bio', 2000],
    ['city', 100],
  ])('aceita %s com exatamente %i caracteres', async (field, max) => {
    expect(await errorsFor(CreateInspectorProfileDto, { ...valid, [field]: 'a'.repeat(max) })).toEqual([]);
  });

  it.each([
    ['bio', 2001],
    ['city', 101],
  ])('rejeita %s com %i caracteres', async (field, length) => {
    expect(await errorsFor(CreateInspectorProfileDto, { ...valid, [field]: 'a'.repeat(length) })).toEqual([
      `${field}:maxLength`,
    ]);
  });

  it('aceita basePriceCents = 500000 (R$ 5.000)', async () => {
    expect(await errorsFor(CreateInspectorProfileDto, { ...valid, basePriceCents: 500_000 })).toEqual([]);
  });

  it('rejeita basePriceCents = 500001', async () => {
    expect(await errorsFor(CreateInspectorProfileDto, { ...valid, basePriceCents: 500_001 })).toEqual([
      'basePriceCents:max',
    ]);
  });

  it('o DTO aceita basePriceCents = 0 (o mínimo de negócio fica no service)', async () => {
    expect(await errorsFor(CreateInspectorProfileDto, { ...valid, basePriceCents: 0 })).toEqual([]);
  });

  it('aceita as 7 especialidades (todas as do enum)', async () => {
    const all = ['ENGINE', 'TRANSMISSION', 'SUSPENSION', 'BRAKES', 'ELECTRICAL', 'BODYWORK', 'AIR_CONDITIONING'];

    expect(await errorsFor(CreateInspectorProfileDto, { ...valid, specialties: all })).toEqual([]);
  });

  it('rejeita specialties com mais de 7 itens', async () => {
    const errors = await errorsFor(CreateInspectorProfileDto, {
      ...valid,
      specialties: Array.from({ length: 8 }, () => 'ENGINE'),
    });

    expect(errors).toContain('specialties:arrayMaxSize');
  });

  it('continua rejeitando especialidades repetidas', async () => {
    const errors = await errorsFor(CreateInspectorProfileDto, { ...valid, specialties: ['ENGINE', 'ENGINE'] });

    expect(errors).toEqual(['specialties:arrayUnique']);
  });
});

describe('UpdateInspectorProfileDto (herda os limites)', () => {
  it('rejeita bio com 2001 caracteres', async () => {
    expect(await errorsFor(UpdateInspectorProfileDto, { bio: 'a'.repeat(2001) })).toEqual(['bio:maxLength']);
  });

  it('rejeita basePriceCents = 500001', async () => {
    expect(await errorsFor(UpdateInspectorProfileDto, { basePriceCents: 500_001 })).toEqual([
      'basePriceCents:max',
    ]);
  });
});
