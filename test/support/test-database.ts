/** Banco usado pelos e2e quando E2E_DATABASE_URL não é informada. */
export const DEFAULT_E2E_DATABASE_URL =
  'postgresql://app:app@localhost:5432/carcheck_test';

/** Nome do banco de desenvolvimento, que os e2e nunca podem usar. */
const DEV_DATABASE_NAME = 'carcheck';

export function e2eDatabaseUrl(): string {
  return process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
}

/**
 * Garante que a URL aponta para um banco de teste. Os e2e apagam todas as
 * tabelas entre um teste e outro: rodar contra o banco de desenvolvimento
 * apagaria os dados dele.
 */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      'E2E: DATABASE_URL não definida. Os e2e precisam de um banco de teste (ex.: carcheck_test).',
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    throw new Error(
      'E2E: DATABASE_URL inválida, não foi possível ler o nome do banco.',
    );
  }

  if (databaseName === DEV_DATABASE_NAME) {
    throw new Error(
      `E2E: DATABASE_URL aponta para o banco de desenvolvimento "${DEV_DATABASE_NAME}". ` +
        'Os e2e apagam os dados entre os testes: use um banco separado, como carcheck_test.',
    );
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `E2E: o banco "${databaseName}" não parece ser de teste. ` +
        'Por segurança, o nome do banco dos e2e precisa terminar em "_test".',
    );
  }
  return url;
}
