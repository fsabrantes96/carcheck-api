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

  it('continua aceitando basePriceCents = 0 (o mínimo de negócio é aplicado no agendamento)', async () => {
    expect(await errorsFor(CreateInspectorProfileDto, { ...valid, basePriceCents: 0 })).toEqual([]);
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
