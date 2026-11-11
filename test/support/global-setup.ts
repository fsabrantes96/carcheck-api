import { execFileSync } from 'node:child_process';
import { assertTestDatabaseUrl, e2eDatabaseUrl } from './test-database.js';

/**
 * Roda uma vez antes dos e2e: recusa qualquer URL que não seja de um banco
 * de teste e aplica as migrations nele com `prisma migrate deploy`.
 */
export default function setup(): void {
  const url = assertTestDatabaseUrl(e2eDatabaseUrl());
  try {
    execFileSync(
      'npx',
      ['prisma', 'migrate', 'deploy', '--config', 'prisma7.config.ts'],
      {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'inherit',
        shell: process.platform === 'win32',
      },
    );
  } catch {
    throw new Error(
      'E2E: não foi possível aplicar as migrations no banco de teste. ' +
        'Confira se o Postgres está de pé (docker compose up -d db) e se o banco existe ' +
        '(docker compose exec -T db psql -U app -d carcheck -c "CREATE DATABASE carcheck_test").',
    );
  }
}
