import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto.js';
import { RegisterDto } from './register.dto.js';

describe('RegisterDto', () => {
  const base = { name: 'Maria Silva', password: 'senha12345' };

  it('normaliza o e-mail com trim e minúsculas', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...base,
      email: '  Maria@X.com ',
    });

    expect(dto.email).toBe('maria@x.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('continua rejeitando e-mail inválido', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...base,
      email: ' nao-e-email ',
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['email']);
    expect(errors[0].constraints).toHaveProperty('isEmail');
  });

  it('rejeita e-mail que não é string sem tentar transformá-lo', async () => {
    const dto = plainToInstance(RegisterDto, { ...base, email: 123 });

    const errors = await validate(dto);

    expect(dto.email).toBe(123);
    expect(errors[0].constraints).toHaveProperty('isEmail');
  });

  it('aceita nome com 100 caracteres e senha com 72', async () => {
    const dto = plainToInstance(RegisterDto, {
      name: 'a'.repeat(100),
      email: 'maria@x.com',
      password: 's'.repeat(72),
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita nome com mais de 100 caracteres', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...base,
      name: 'a'.repeat(101),
      email: 'maria@x.com',
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['name']);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('rejeita senha com mais de 72 caracteres', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...base,
      email: 'maria@x.com',
      password: 's'.repeat(73),
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['password']);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('aceita e-mail com 254 caracteres', async () => {
    const dto = plainToInstance(RegisterDto, { ...base, email: emailOfLength(254) });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita e-mail com 255 caracteres', async () => {
    const dto = plainToInstance(RegisterDto, { ...base, email: emailOfLength(255) });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['email']);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it.each([
    ['acentos', 'é'.repeat(36)],
    ['emoji', '😀'.repeat(18)],
  ])('aceita senha com %s que ocupa exatamente 72 bytes', async (_, password) => {
    expect(Buffer.byteLength(password, 'utf8')).toBe(72);
    const dto = plainToInstance(RegisterDto, { ...base, email: 'maria@x.com', password });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    ['acentos', 'é'.repeat(37)],
    ['emoji', '😀'.repeat(19)],
  ])('rejeita senha com %s acima de 72 bytes, mesmo com menos de 72 caracteres', async (_, password) => {
    expect(password.length).toBeLessThanOrEqual(72);
    expect(Buffer.byteLength(password, 'utf8')).toBeGreaterThan(72);
    const dto = plainToInstance(RegisterDto, { ...base, email: 'maria@x.com', password });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['password']);
    expect(errors[0].constraints).toEqual({
      maxBytes: 'password deve ter no máximo 72 bytes',
    });
  });
});

/**
 * E-mail válido com exatamente `length` caracteres: parte local de 64,
 * rótulos de domínio de até 63 e o resto num rótulo variável antes do ".com".
 */
function emailOfLength(length: number): string {
  // "a"×64 + "@" + "b"×63 + "." + "c"×63 + "." + <variável> + ".com"
  const fixed = 64 + 1 + 63 + 1 + 63 + 1 + 4;
  return `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(length - fixed)}.com`;
}

describe('LoginDto', () => {
  const base = { password: 'senha12345' };

  it('normaliza o e-mail com trim e minúsculas', async () => {
    const dto = plainToInstance(LoginDto, { ...base, email: ' Maria@X.com ' });

    expect(dto.email).toBe('maria@x.com');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('continua rejeitando e-mail inválido', async () => {
    const dto = plainToInstance(LoginDto, { ...base, email: 'maria@' });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['email']);
    expect(errors[0].constraints).toHaveProperty('isEmail');
  });

  it('rejeita e-mail que não é string sem tentar transformá-lo', async () => {
    const dto = plainToInstance(LoginDto, { ...base, email: 123 });

    const errors = await validate(dto);

    expect(dto.email).toBe(123);
    expect(errors[0].constraints).toHaveProperty('isEmail');
  });

  it('aceita senha com 72 caracteres', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'maria@x.com',
      password: 's'.repeat(72),
    });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita senha com mais de 72 caracteres', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'maria@x.com',
      password: 's'.repeat(73),
    });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['password']);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('aceita e-mail com 254 caracteres', async () => {
    const dto = plainToInstance(LoginDto, { ...base, email: emailOfLength(254) });

    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejeita e-mail com 255 caracteres', async () => {
    const dto = plainToInstance(LoginDto, { ...base, email: emailOfLength(255) });

    const errors = await validate(dto);

    expect(errors.map((e) => e.property)).toEqual(['email']);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('não mede a senha em bytes: o login não revela o limite (segue para o 401 do service)', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'maria@x.com',
      password: 'é'.repeat(37),
    });

    expect(await validate(dto)).toHaveLength(0);
  });
});
