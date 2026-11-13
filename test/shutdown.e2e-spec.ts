import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import request from 'supertest';
import { createTestApp } from './support/test-app.js';

/**
 * Conexões de clientes abertas no banco de teste, sem contar a desta consulta
 * nem os processos internos do Postgres (ex.: autovacuum). Fica num arquivo
 * próprio: os arquivos e2e rodam um por vez e cada um fecha a sua app.
 */
async function openBackends(): Promise<number> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database()
         AND backend_type = 'client backend'
         AND pid <> pg_backend_pid()`,
    );
    return result.rows[0].n;
  } finally {
    await client.end();
  }
}

/** O fim da conexão no servidor pode chegar um pouco depois do client.end(). */
async function waitForBackends(
  expected: number,
  timeoutMs = 3000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let current = await openBackends();
  while (current !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    current = await openBackends();
  }
  return current;
}

describe('Encerramento da aplicação (e2e, risco 24)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    // Só se uma asserção falhou antes do close do próprio teste.
    await app?.close();
  });

  it('app.close() sozinho fecha todas as conexões da app com o banco', async () => {
    // Sessões de fora (psql, Prisma Studio) entram na linha de base.
    const baseline = await openBackends();
    app = await createTestApp();
    // Uma rota que consulta o banco, para o pool ter conexões abertas.
    await request(app.getHttpServer()).get('/listings').expect(200);
    expect(await openBackends()).toBeGreaterThan(baseline);

    const closing = app;
    app = undefined;
    await closing.close();

    expect(await waitForBackends(baseline)).toBe(baseline);
  });
});
