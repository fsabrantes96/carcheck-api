import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

/**
 * O openapi.json da raiz é o contrato que o front usa para gerar os tipos.
 * Este teste gera o documento a partir do código (sem servidor e sem banco:
 * o NestFactory.create não roda o onModuleInit, então o Prisma não conecta)
 * e compara com o arquivo versionado.
 *
 * - `npm run openapi` regrava o arquivo (vitest -u).
 * - No CI (CI=true) o Vitest não grava snapshots: arquivo divergente ou
 *   ausente faz o teste falhar.
 */
describe('openapi.json', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Valores fictícios só para o boot do módulo: nada aqui conecta ou assina.
    // A porta 1 garante que uma conexão acidental falharia.
    vi.stubEnv('DATABASE_URL', 'postgresql://openapi:openapi@127.0.0.1:1/openapi');
    vi.stubEnv('JWT_SECRET', 'segredo-apenas-para-gerar-o-openapi');
    vi.stubEnv('PLATFORM_FEE_BPS', '1000');
    vi.stubEnv('JOBS_ENABLED', 'false');
    // Import dinâmico: o ConfigModule.forRoot valida o ambiente ao carregar o AppModule.
    const { AppModule } = await import('../app.module.js');
    const { createHttpAdapter } = await import('../app.setup.js');
    app = await NestFactory.create(AppModule, createHttpAdapter(), { logger: false });
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('está atualizado com o código (se falhar, rode npm run openapi e versione o arquivo)', async () => {
    const { buildOpenApiDocument, serializeOpenApiDocument } = await import('./openapi-document.js');

    await expect(serializeOpenApiDocument(buildOpenApiDocument(app))).toMatchFileSnapshot(
      '../../openapi.json',
    );
  });
});
