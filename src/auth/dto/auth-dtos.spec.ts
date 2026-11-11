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
});
