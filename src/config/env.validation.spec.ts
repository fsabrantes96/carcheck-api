import { isJobsEnabled, validateEnv } from './env.validation.js';

const valid = { PLATFORM_FEE_BPS: '1000', DATABASE_URL: 'postgresql://x' };

function messageOf(config: Record<string, unknown>): string {
  try {
    validateEnv(config);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('validateEnv deveria ter lançado');
}

describe('validateEnv', () => {
  it('converte PLATFORM_FEE_BPS para número e aplica os padrões das outras variáveis', () => {
    const result = validateEnv(valid);

    expect(result).toMatchObject({
      PLATFORM_FEE_BPS: 1000,
      MIN_INSPECTION_PRICE_CENTS: 5000,
      APPOINTMENT_DURATION_MINUTES: 60,
      APPOINTMENT_MIN_NOTICE_HOURS: 24,
    });
  });

  it('mantém as outras variáveis recebidas (ex.: DATABASE_URL)', () => {
    expect(validateEnv(valid).DATABASE_URL).toBe('postgresql://x');
  });

  it('usa os valores informados no lugar dos padrões', () => {
    const result = validateEnv({
      ...valid,
      MIN_INSPECTION_PRICE_CENTS: '7500',
      APPOINTMENT_DURATION_MINUTES: '90',
      APPOINTMENT_MIN_NOTICE_HOURS: '0',
    });

    expect(result).toMatchObject({
      MIN_INSPECTION_PRICE_CENTS: 7500,
      APPOINTMENT_DURATION_MINUTES: 90,
      APPOINTMENT_MIN_NOTICE_HOURS: 0,
    });
  });

  it('aceita os limites de PLATFORM_FEE_BPS (0 e 10000)', () => {
    expect(validateEnv({ PLATFORM_FEE_BPS: '0' }).PLATFORM_FEE_BPS).toBe(0);
    expect(validateEnv({ PLATFORM_FEE_BPS: '10000' }).PLATFORM_FEE_BPS).toBe(10000);
  });

  it('aceita espaços em volta do número', () => {
    expect(validateEnv({ PLATFORM_FEE_BPS: ' 250 ' }).PLATFORM_FEE_BPS).toBe(250);
  });

  it('lança dizendo que PLATFORM_FEE_BPS é obrigatória quando ausente', () => {
    expect(messageOf({})).toContain(
      'PLATFORM_FEE_BPS é obrigatória: comissão da plataforma em pontos-base, inteiro entre 0 e 10000 (1000 = 10%).',
    );
  });

  it('trata PLATFORM_FEE_BPS vazia como ausente', () => {
    expect(messageOf({ PLATFORM_FEE_BPS: '  ' })).toContain('PLATFORM_FEE_BPS é obrigatória');
  });

  it.each(['10001', '-1', '10.5', 'abc', '1e3'])(
    'rejeita PLATFORM_FEE_BPS = %s mostrando o valor recebido',
    (raw) => {
      expect(messageOf({ PLATFORM_FEE_BPS: raw })).toContain(
        `PLATFORM_FEE_BPS inválida (recebido: "${raw}")`,
      );
    },
  );

  it.each([
    ['MIN_INSPECTION_PRICE_CENTS', '0'],
    ['APPOINTMENT_DURATION_MINUTES', '0'],
    ['APPOINTMENT_DURATION_MINUTES', '1441'],
    ['APPOINTMENT_MIN_NOTICE_HOURS', '-1'],
    ['APPOINTMENT_MIN_NOTICE_HOURS', '1440'],
  ])('rejeita %s = %s', (name, raw) => {
    expect(messageOf({ ...valid, [name]: raw })).toContain(`${name} inválida (recebido: "${raw}")`);
  });

  it('lista todos os problemas de uma vez e aponta o .env.example', () => {
    const message = messageOf({ APPOINTMENT_DURATION_MINUTES: 'x' });

    expect(message).toContain('Configuração inválida. Corrija as variáveis de ambiente (veja o .env.example):');
    expect(message).toContain('PLATFORM_FEE_BPS é obrigatória');
    expect(message).toContain('APPOINTMENT_DURATION_MINUTES inválida');
  });
});

describe('JOBS_ENABLED', () => {
  it('ausente vale true', () => {
    expect(validateEnv(valid).JOBS_ENABLED).toBe(true);
  });

  it('vazia é tratada como ausente (true)', () => {
    expect(validateEnv({ ...valid, JOBS_ENABLED: '  ' }).JOBS_ENABLED).toBe(true);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['TRUE', true],
    [' False ', false],
  ])('aceita %j como %s', (raw, expected) => {
    expect(validateEnv({ ...valid, JOBS_ENABLED: raw }).JOBS_ENABLED).toBe(expected);
  });

  it('aceita boolean já convertido', () => {
    expect(validateEnv({ ...valid, JOBS_ENABLED: false }).JOBS_ENABLED).toBe(false);
  });

  it.each(['sim', 'yes', '1', '0', 'off'])('rejeita JOBS_ENABLED = %s mostrando o valor recebido', (raw) => {
    expect(messageOf({ ...valid, JOBS_ENABLED: raw })).toContain(
      `JOBS_ENABLED inválida (recebido: "${raw}"): liga os jobs agendados, true ou false (padrão true).`,
    );
  });
});

describe('isJobsEnabled (condição do módulo de jobs, lida do process.env)', () => {
  it('ausente vale true, como no validateEnv', () => {
    expect(isJobsEnabled({})).toBe(true);
  });

  it.each([
    ['true', true],
    ['false', false],
    [' FALSE ', false],
    ['', true],
  ])('%j vale %s, como no validateEnv', (raw, expected) => {
    expect(isJobsEnabled({ JOBS_ENABLED: raw })).toBe(expected);
    expect(validateEnv({ ...valid, JOBS_ENABLED: raw }).JOBS_ENABLED).toBe(expected);
  });

  it('valor inválido não liga os jobs (o boot já falhou no validateEnv)', () => {
    expect(isJobsEnabled({ JOBS_ENABLED: 'sim' })).toBe(false);
  });
});
