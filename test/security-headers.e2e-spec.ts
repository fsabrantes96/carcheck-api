import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { closeTestApp, createTestApp } from './support/test-app.js';

/**
 * Cabeçalhos de segurança do helmet em toda a API, inclusive na documentação
 * (risco 21 do docs/audit.md). A CSP é a padrão do helmet, sem exceção para
 * /docs.
 */
describe('Cabeçalhos de segurança (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function expectHelmetHeaders(headers: Record<string, string | undefined>) {
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['referrer-policy']).toBe('no-referrer');
  }

  it.each([
    ['uma rota pública da API', '/listings', 200],
    ['uma rota protegida sem token', '/listings/mine', 401],
    ['uma rota inexistente', '/rota-que-nao-existe', 404],
    ['a página da documentação', '/docs/', 200],
    ['o JSON do OpenAPI', '/docs-json', 200],
  ])('envia os cabeçalhos do helmet em %s', async (_caso, path, status) => {
    const res = await request(app.getHttpServer()).get(path).expect(status);

    expectHelmetHeaders(res.headers);
  });

  it('envia os cabeçalhos do helmet no 413 do body-parser (o helmet vem antes do parser)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(200 * 1024) }))
      .expect(413);

    expectHelmetHeaders(res.headers);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each([
    ['uma rota da API', '/listings'],
    ['uma resposta de erro', '/rota-que-nao-existe'],
    ['a documentação', '/docs/'],
  ])('não envia X-Powered-By em %s', async (_caso, path) => {
    const res = await request(app.getHttpServer()).get(path);

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('usa na documentação a mesma CSP da API (sem afrouxar em /docs)', async () => {
    const api = await request(app.getHttpServer()).get('/listings').expect(200);
    const docs = await request(app.getHttpServer()).get('/docs/').expect(200);

    expect(api.headers['content-security-policy']).toBeDefined();
    expect(docs.headers['content-security-policy']).toBe(
      api.headers['content-security-policy'],
    );
  });

  describe('Swagger UI continua funcionando', () => {
    it('GET /docs/ responde 200 com o HTML do Swagger UI', async () => {
      const res = await request(app.getHttpServer()).get('/docs/').expect(200);

      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('swagger-ui-init.js');
    });

    it('a página não tem script inline (a CSP padrão só permite scripts da mesma origem)', async () => {
      const res = await request(app.getHttpServer()).get('/docs/').expect(200);

      const scripts = res.text.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length).toBeGreaterThan(0);
      for (const tag of scripts) {
        expect(tag).toMatch(/\bsrc="\.\//);
      }
    });

    it('a página não tem atributos de evento inline (a CSP padrão bloqueia com script-src-attr none)', async () => {
      const res = await request(app.getHttpServer()).get('/docs/').expect(200);

      expect(res.text).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
    });

    it.each([
      '/docs/swagger-ui-init.js',
      '/docs/swagger-ui-bundle.js',
      '/docs/swagger-ui-standalone-preset.js',
      '/docs/swagger-ui.css',
    ])('GET %s responde 200', async (path) => {
      await request(app.getHttpServer()).get(path).expect(200);
    });

    it('GET /docs-json responde 200 com o documento OpenAPI', async () => {
      const res = await request(app.getHttpServer())
        .get('/docs-json')
        .expect(200);

      expect(res.body.openapi).toMatch(/^3\./);
    });
  });
});
