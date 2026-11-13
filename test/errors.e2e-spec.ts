import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DEFAULT_PASSWORD, ERROR_KEYS } from './support/fixtures.js';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
} from './support/test-app.js';

describe('Erros do body-parser (e2e, risco 20)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('responde 413 "Corpo da requisição muito grande" a um JSON de ~200 KB', async () => {
    const body = JSON.stringify({
      email: 'maria@x.com',
      password: DEFAULT_PASSWORD,
      padding: 'x'.repeat(200 * 1024),
    });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(413);

    expect(res.body).toMatchObject({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'Corpo da requisição muito grande',
      path: '/auth/login',
    });
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
    expect(JSON.stringify(res.body)).not.toContain('entity too large');
  });

  it('responde 400 "Corpo da requisição inválido" a um JSON malformado', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "maria@x.com", "password": "segredo')
      .expect(400);

    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Corpo da requisição inválido',
      path: '/auth/login',
    });
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/JSON|Unexpected|Unterminated/);
    expect(serialized).not.toContain('segredo');
  });
});

describe('Parâmetro de rota com codificação inválida (e2e, risco 23)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  // O router do Express lança URIError com status 400 ao decodificar '%FF';
  // o ExpressAdapter do Nest (12.5+) o converte em BadRequestException.
  it('responde 400 no formato global de erro a GET /listings/%FF', async () => {
    const res = await request(app.getHttpServer())
      .get('/listings/%FF')
      .expect(400);

    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      path: '/listings/%FF',
    });
    expect(typeof res.body.message).toBe('string');
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
  });
});

describe('Banco indisponível (e2e)', () => {
  let app: INestApplication<App>;
  let loggerError: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    // Prisma e driver reais, apontando para uma porta onde nada escuta.
    const unreachable = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: 'postgresql://app:app@127.0.0.1:1/carcheck_test',
      }),
    });
    app = await createTestApp({
      configure: (builder) =>
        builder.overrideProvider(PrismaService).useValue(unreachable),
    });
  });

  beforeEach(() => {
    loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('responde 500 genérico sem vazar detalhes e registra o erro real no log', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'maria@x.com', password: DEFAULT_PASSWORD })
      .expect(500);

    expect(res.body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Erro interno do servidor',
      path: '/auth/login',
    });
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);

    const serialized = JSON.stringify(res.body);
    for (const leak of ['127.0.0.1', 'ECONNREFUSED', 'SELECT', 'User', 'at ']) {
      expect(serialized).not.toContain(leak);
    }
    expect(serialized.toLowerCase()).not.toContain('prisma');

    expect(loggerError).toHaveBeenCalledWith(
      'Erro não tratado em POST /auth/login',
      expect.stringMatching(/ECONNREFUSED|127\.0\.0\.1|connect/i),
    );
  });
});
