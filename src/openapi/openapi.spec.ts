import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { buildOpenApiDocument, serializeOpenApiDocument } from './openapi-document.js';

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
    // Valores fictícios para todas as variáveis que o validateEnv lê, para o
    // resultado não depender do .env de quem roda. O .env ainda é lido (pelo
    // dotenv/config do PrismaService e pelo ConfigModule), mas não sobrescreve
    // o que já está no ambiente; DOTENV_OVERRIDE=false garante isso mesmo se o
    // shell tiver DOTENV_OVERRIDE=true. A porta 1 faz uma conexão acidental
    // falhar.
    vi.stubEnv('DOTENV_OVERRIDE', 'false');
    vi.stubEnv('DATABASE_URL', 'postgresql://openapi:openapi@127.0.0.1:1/openapi');
    vi.stubEnv('JWT_SECRET', 'segredo-apenas-para-gerar-o-openapi');
    vi.stubEnv('JWT_EXPIRES_IN_SECONDS', '3600');
    vi.stubEnv('PLATFORM_FEE_BPS', '1000');
    vi.stubEnv('MIN_INSPECTION_PRICE_CENTS', '5000');
    vi.stubEnv('APPOINTMENT_DURATION_MINUTES', '60');
    vi.stubEnv('APPOINTMENT_MIN_NOTICE_HOURS', '24');
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
    await expect(serializeOpenApiDocument(buildOpenApiDocument(app))).toMatchFileSnapshot(
      '../../openapi.json',
    );
  });
});
