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
});

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
});
