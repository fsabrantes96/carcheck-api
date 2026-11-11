import {
  assertTestDatabaseUrl,
  DEFAULT_E2E_DATABASE_URL,
} from './test-database.js';

describe('assertTestDatabaseUrl', () => {
  it('aceita a URL padrão do banco carcheck_test', () => {
    expect(assertTestDatabaseUrl(DEFAULT_E2E_DATABASE_URL)).toBe(
      DEFAULT_E2E_DATABASE_URL,
    );
  });

  it('aceita outro banco terminado em _test (ex.: no CI)', () => {
    const url = 'postgresql://ci:ci@db:5432/outro_test?schema=public';

    expect(assertTestDatabaseUrl(url)).toBe(url);
  });

  it('recusa o banco de desenvolvimento carcheck com mensagem clara', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://app:app@localhost:5432/carcheck'),
    ).toThrow(
      'E2E: DATABASE_URL aponta para o banco de desenvolvimento "carcheck". ' +
        'Os e2e apagam os dados entre os testes: use um banco separado, como carcheck_test.',
    );
  });

  it('recusa o banco carcheck mesmo com parâmetros na URL', () => {
    expect(() =>
      assertTestDatabaseUrl(
        'postgresql://app:app@localhost:5432/carcheck?schema=public',
      ),
    ).toThrow('aponta para o banco de desenvolvimento "carcheck"');
  });

  it('recusa um banco cujo nome não termina em _test', () => {
    expect(() =>
      assertTestDatabaseUrl('postgresql://app:app@localhost:5432/producao'),
    ).toThrow(
      'E2E: o banco "producao" não parece ser de teste. ' +
        'Por segurança, o nome do banco dos e2e precisa terminar em "_test".',
    );
  });

  it('recusa URL ausente', () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(
      'E2E: DATABASE_URL não definida.',
    );
  });

  it('recusa URL que não pode ser lida', () => {
    expect(() => assertTestDatabaseUrl('isto não é uma url')).toThrow(
      'E2E: DATABASE_URL inválida, não foi possível ler o nome do banco.',
    );
  });
});
