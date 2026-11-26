import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ERROR_KEYS } from './support/fixtures.js';
import { closeTestApp, createTestApp } from './support/test-app.js';

/**
 * DOCS_ENABLED (risco 61): desligada, a instância não serve o Swagger UI, o
 * JSON do OpenAPI nem os assets; a resposta é o 404 de rota no formato global.
 * O configureApp lê a variável do process.env (isDocsEnabled), então cada app
 * é criada depois do stub.
 */
describe('DOCS_ENABLED (e2e)', () => {
  const DOCS_PATHS = ['/docs', '/docs/', '/docs-json', '/docs/swagger-ui.css'];

  describe('desligada', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      vi.stubEnv('DOCS_ENABLED', 'false');
      app = await createTestApp();
    });

    afterAll(async () => {
      await closeTestApp(app);
      vi.unstubAllEnvs();
    });

    it.each(DOCS_PATHS)(
      'responde 404 ROUTE_NOT_FOUND no formato global a GET %s',
      async (path) => {
        const res = await request(app.getHttpServer()).get(path);

        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({
          statusCode: 404,
          code: 'ROUTE_NOT_FOUND',
          message: 'Rota não encontrada',
        });
        expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['content-type']).toBe(
          'application/json; charset=utf-8',
        );
      },
    );

    it('continua servindo a API', async () => {
      await request(app.getHttpServer()).get('/listings').expect(200);
    });
  });

  describe('ligada', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      vi.stubEnv('DOCS_ENABLED', 'true');
      app = await createTestApp();
    });

    afterAll(async () => {
      await closeTestApp(app);
      vi.unstubAllEnvs();
    });

    it.each(['/docs/', '/docs-json', '/docs/swagger-ui.css'])(
      'responde 200 a GET %s',
      async (path) => {
        await request(app.getHttpServer()).get(path).expect(200);
      },
    );
  });
});
