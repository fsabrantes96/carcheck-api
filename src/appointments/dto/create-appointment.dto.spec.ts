import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAppointmentDto } from './create-appointment.dto.js';

const valid = {
  listingId: '11111111-1111-4111-8111-111111111111',
  inspectorProfileId: '22222222-2222-4222-8222-222222222222',
  startsAt: '2030-01-03T12:00:00.000Z',
};

// Mesmas opções do ValidationPipe global (src/app.setup.ts).
async function errorsFor(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(CreateAppointmentDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property).sort();
}

describe('CreateAppointmentDto', () => {
  it('aceita anúncio, perfil do avaliador e início com fuso', async () => {
    expect(await errorsFor(valid)).toEqual([]);
  });

  it('aceita início com offset (-03:00)', async () => {
    expect(await errorsFor({ ...valid, startsAt: '2030-01-03T09:00:00-03:00' })).toEqual([]);
  });

  it.each(['status', 'priceCents', 'buyerId', 'sellerId', 'inspectorUserId', 'platformFeeBps'])(
    'rejeita o campo %s (o cliente nunca escolhe)',
    async (field) => {
      expect(await errorsFor({ ...valid, [field]: 'x' })).toEqual([field]);
    },
  );

  it.each([
    ['sem fuso', '2030-01-03T12:00:00'],
    ['só a data', '2030-01-03'],
    ['texto', 'amanhã'],
  ])('rejeita startsAt %s', async (_label, startsAt) => {
    expect(await errorsFor({ ...valid, startsAt })).toEqual(['startsAt']);
  });

  it('a mensagem de startsAt sem fuso é em pt-BR', async () => {
    const [error] = await validate(
      plainToInstance(CreateAppointmentDto, { ...valid, startsAt: '2030-01-03T12:00:00' }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(Object.values(error.constraints ?? {})).toContain('startsAt precisa ter fuso horário (Z ou ±hh:mm)');
  });

  it.each(['listingId', 'inspectorProfileId'])('rejeita %s que não é uuid', async (field) => {
    expect(await errorsFor({ ...valid, [field]: '123' })).toEqual([field]);
  });
});
