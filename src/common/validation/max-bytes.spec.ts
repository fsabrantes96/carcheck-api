import { validate } from 'class-validator';
import { MaxBytes } from './max-bytes.js';

class Sample {
  @MaxBytes(4)
  value: unknown;
}

async function constraintsFor(value: unknown) {
  const sample = new Sample();
  sample.value = value;
  const errors = await validate(sample);
  return errors[0]?.constraints;
}

describe('MaxBytes', () => {
  it('aceita string com exatamente o limite em bytes UTF-8 (2 × "é" = 4 bytes)', async () => {
    expect(await constraintsFor('éé')).toBeUndefined();
  });

  it('rejeita string acima do limite em bytes com menos caracteres que o limite (emoji + "a" = 5 bytes)', async () => {
    expect(await constraintsFor('😀a')).toEqual({ maxBytes: 'value deve ter no máximo 4 bytes' });
  });

  it.each([123, null, ['ab']])('rejeita valor que não é string (%j), como o @MaxLength', async (value) => {
    expect(await constraintsFor(value)).toHaveProperty('maxBytes');
  });
});
