import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateListingDto } from './update-listing.dto.js';

// Mesmas opções do ValidationPipe global (src/app.setup.ts).
async function errorsFor(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateListingDto, body);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdateListingDto', () => {
  it('rejeita status: o status muda só pelas rotas de transição', async () => {
    const errors = await errorsFor({ status: 'SOLD' });

    expect(errors.map((e) => e.property)).toEqual(['status']);
    expect(errors[0].constraints).toEqual({
      whitelistValidation: 'property status should not exist',
    });
  });

  it('aceita um update parcial só com o título', async () => {
    const errors = await errorsFor({ title: 'Novo título do anúncio' });

    expect(errors).toEqual([]);
  });
});
