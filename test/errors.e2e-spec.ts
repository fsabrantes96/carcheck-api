import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaPg } from '@prisma/adapter-pg';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  DEFAULT_PASSWORD,
  ERROR_KEYS,
  listingPayload,
  registerAndLogin,
} from './support/fixtures.js';
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

  // O router do Express lança URIError com status 400 ao decodificar '%FF', e
  // o ExpressAdapter do Nest o converte em BadRequestException (desde a 12.5,
  // só com status 400; antes, qualquer URIError). O AppExpressAdapter troca a
  // mensagem crua ("Failed to decode param '%FF'") por uma fixa (risco 65).
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
    expect(res.body.message).toBe('Parâmetro inválido na URL');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
  });
});

describe('Erros da camada do Express (e2e, riscos 65 e 67)', () => {
  let app: INestApplication<App>;
  const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function expectGlobalError(
    res: request.Response,
    statusCode: number,
    error: string,
    message: string,
    path: string,
  ) {
    expect(res.headers['content-type']).toBe(JSON_CONTENT_TYPE);
    expect(res.body).toMatchObject({ statusCode, error, message, path });
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
  }

  it('responde 400 "Corpo da requisição inválido" a um corpo urlencoded com mais de 32 níveis', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a' + '[b]'.repeat(40) + '=1')
      .expect(400);

    expectGlobalError(
      res,
      400,
      'Bad Request',
      'Corpo da requisição inválido',
      '/auth/login',
    );
    expect(JSON.stringify(res.body)).not.toContain('depth');
  });

  // GET /listings/%FF está no bloco do risco 23, acima.
  it('não repete o parâmetro cru na mensagem nem nos erros do %FF', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments/%FF/accept')
      .expect(400);

    expectGlobalError(
      res,
      400,
      'Bad Request',
      'Parâmetro inválido na URL',
      '/appointments/%FF/accept',
    );
    expect(res.body.message).not.toContain('%FF');
    expect(res.body.message).not.toMatch(/decode/i);
    expect(res.body).not.toHaveProperty('errors');
  });

  // O body-parser repassa o erro do zlib num http-error 400 sem `type`. Um
  // e2e por formato, para um upgrade do Node ou do body-parser aparecer aqui.
  // zstd exige Node 23+ (zlib.createZstdDecompress); o CI roda em Node 24.
  it.each([
    ['gzip', 'incorrect header check'],
    ['deflate', 'incorrect header check'],
    ['br', 'Decompression failed'],
    ['zstd', 'Unknown frame descriptor'],
  ])(
    'responde 400 "Corpo da requisição inválido" a um corpo %s corrompido',
    async (encoding, rawMessage) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', encoding)
        .send(Buffer.from('isto-nao-esta-comprimido'))
        .expect(400);

      expectGlobalError(
        res,
        400,
        'Bad Request',
        'Corpo da requisição inválido',
        '/auth/login',
      );
      expect(res.body.code).toBe('INVALID_BODY');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toContain(rawMessage);
    },
  );

  describe('assets do /docs', () => {
    const ASSET = '/docs/swagger-ui.css';
    let assetEtag: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer()).get(ASSET).expect(200);
      assetEtag = res.headers['etag'];
      expect(assetEtag).toBeTruthy();
    });

    function expectNoFileHeaders(res: request.Response) {
      expect(res.headers['etag']).not.toBe(assetEtag);
      expect(res.headers).not.toHaveProperty('last-modified');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers).not.toHaveProperty('accept-ranges');
      expect(Number(res.headers['content-length'])).toBe(
        Buffer.byteLength(res.text),
      );
      // Os cabeçalhos do helmet continuam.
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeTruthy();
    }

    it.each([
      ['If-Match', '"x"'],
      ['If-Unmodified-Since', 'Mon, 01 Jan 1990 00:00:00 GMT'],
    ])(
      'responde 412 em JSON, sem os cabeçalhos do arquivo, a %s',
      async (header, value) => {
        const res = await request(app.getHttpServer())
          .get(ASSET)
          .set(header, value)
          .expect(412);

        expectGlobalError(
          res,
          412,
          'Precondition Failed',
          'Pré-condição da requisição não atendida',
          ASSET,
        );
        expectNoFileHeaders(res);
      },
    );

    it('responde 416 em JSON, sem os cabeçalhos do arquivo e mantendo o Content-Range, a um Range inválido', async () => {
      const res = await request(app.getHttpServer())
        .get(ASSET)
        .set('Range', 'bytes=99999999-')
        .expect(416);

      expectGlobalError(
        res,
        416,
        'Requested Range Not Satisfiable',
        'Intervalo solicitado inválido',
        ASSET,
      );
      expectNoFileHeaders(res);
      expect(res.headers['content-range']).toMatch(/^bytes \*\/\d+$/);
    });
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

  it('responde o 500 com o code INTERNAL_ERROR e no-store', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'maria@x.com', password: DEFAULT_PASSWORD })
      .expect(500);

    expect(res.body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno do servidor',
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });
});

describe('Contrato de erros da camada HTTP (e2e, fix/error-contract)', () => {
  let app: INestApplication<App>;
  const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
  const UNSUPPORTED = 'Formato da requisição não suportado';

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function expectError(res: request.Response, statusCode: number, message: string) {
    expect(res.status).toBe(statusCode);
    expect(res.headers['content-type']).toBe(JSON_CONTENT_TYPE);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ statusCode, message });
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
  }

  describe('rota inexistente (risco 68)', () => {
    it.each([
      ['GET', '/nao-existe'],
      ['GET', '/docs/swagger-ui.css%00'],
      ['GET', '/docs/%FF'],
      ['DELETE', '/auth/login'],
      ['POST', '/listings/a/b/c'],
    ])('responde 404 "Rota não encontrada" a %s %s, sem repetir a URL na mensagem', async (method, path) => {
      const res = await request(app.getHttpServer())[method.toLowerCase() as 'get'](path);

      expectError(res, 404, 'Rota não encontrada');
      expect(res.body.message).not.toContain('Cannot');
      expect(res.body.message).not.toContain(path);
    });

    it('mantém a mensagem do service no 404 de recurso', async () => {
      const res = await request(app.getHttpServer()).get(
        '/listings/00000000-0000-4000-8000-000000000000',
      );

      expectError(res, 404, 'Anúncio não encontrado');
    });
  });

  it('responde 400 "Identificador inválido" a um :id que não é uuid (risco 70)', async () => {
    const res = await request(app.getHttpServer()).get('/listings/abc');

    expectError(res, 400, 'Identificador inválido');
  });

  it('responde 401 "Token inválido ou expirado" ao token válido de uma conta que não existe mais (risco 71)', async () => {
    const token = app.get(JwtService).sign({
      sub: '00000000-0000-4000-8000-000000000000',
      email: 'fantasma@x.com',
    });

    const res = await request(app.getHttpServer())
      .get('/inspectors/me')
      .set('Authorization', `Bearer ${token}`);

    expectError(res, 401, 'Token inválido ou expirado');
  });

  describe('415 por Content-Type', () => {
    it('responde 415 a um corpo text/plain', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'text/plain')
        .send('email=maria@x.com');

      expectError(res, 415, UNSUPPORTED);
    });

    it('responde 415 antes da autenticação: sem token e com corpo text/plain, não 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .set('Content-Type', 'text/plain')
        .send('qualquer coisa');

      expectError(res, 415, UNSUPPORTED);
    });

    it.each([
      'application/json',
      'application/json; charset=utf-8',
      'Application/JSON; Charset=UTF-8',
      'application/json;charset=utf-8',
      'application/json ; charset=utf-8',
    ])('lê um corpo JSON com Content-Type %j', async (contentType) => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', contentType)
        .send(JSON.stringify({ email: 'ninguem@x.com', password: DEFAULT_PASSWORD }));

      expectError(res, 401, 'E-mail ou senha inválidos');
    });

    it('lê um corpo urlencoded', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .type('form')
        .send({ email: 'ninguem@x.com', password: DEFAULT_PASSWORD });

      expectError(res, 401, 'E-mail ou senha inválidos');
    });

    it.each([
      ['sem Content-Type', undefined],
      ['com Content-Type text/plain e corpo vazio', 'text/plain'],
    ])('deixa passar um POST sem corpo (pause) %s', async (_caso, contentType) => {
      const seller = await registerAndLogin(app, 'vendedor@x.com');
      const created = await request(app.getHttpServer())
        .post('/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send(listingPayload())
        .expect(201);

      const req = request(app.getHttpServer())
        .post(`/listings/${created.body.id}/pause`)
        .set('Authorization', `Bearer ${seller.token}`);
      if (contentType) req.set('Content-Type', contentType);
      const res = await req;

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PAUSED');
    });
  });

  it.each([
    ['Content-Encoding desconhecido', { 'Content-Type': 'application/json', 'Content-Encoding': 'xpto' }],
    ['charset não suportado', { 'Content-Type': 'application/json; charset=latin9' }],
  ])('responde 415 "Formato da requisição não suportado" a %s', async (_caso, headers) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set(headers)
      .send('{}');

    expectError(res, 415, UNSUPPORTED);
    expect(JSON.stringify(res.body)).not.toMatch(/xpto|latin9/i);
  });

  it('responde 413 "Corpo da requisição muito grande" a parâmetros demais no urlencoded', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(Array.from({ length: 1100 }, (_, i) => `a${i}=1`).join('&'));

    expectError(res, 413, 'Corpo da requisição muito grande');
  });

  it.each([
    ['400 de validação', () => request(app.getHttpServer()).post('/auth/login').send({}), 400],
    ['401 sem token', () => request(app.getHttpServer()).get('/listings/mine'), 401],
    ['400 de JSON malformado', () => request(app.getHttpServer()).post('/auth/login').set('Content-Type', 'application/json').send('{"a":'), 400],
  ])('grava Cache-Control: no-store no %s', async (_caso, send, status) => {
    const res = await send();

    expect(res.status).toBe(status);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toBe(JSON_CONTENT_TYPE);
  });
});

describe('Erro depois do envio dos cabeçalhos (e2e, risco 69)', () => {
  let app: INestApplication<App>;
  let server: http.Server;
  let loggerError: ReturnType<typeof vi.spyOn>;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeAll(async () => {
    app = await createTestApp({
      // Um middleware do teste que começa a resposta e falha no meio, como um
      // asset do /docs cujo arquivo some durante o stream.
      beforeInit: (created) =>
        created.use('/teste-falha-no-meio', (_req: Request, res: Response, next: NextFunction) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.write('parcial');
          next(new Error('falha no meio do envio'));
        }),
    });
    server = app.getHttpServer() as unknown as http.Server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.on('unhandledRejection', onUnhandled);
  });

  beforeEach(() => {
    unhandled.length = 0;
    loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    process.off('unhandledRejection', onUnhandled);
    await closeTestApp(app);
  });

  /** GET cru: devolve o que chegou e se a conexão foi encerrada sem terminar a resposta. */
  function rawGet(path: string): Promise<{ status?: number; body: string; aborted: boolean }> {
    const { port } = server.address() as AddressInfo;
    return new Promise((resolve) => {
      let body = '';
      let status: number | undefined;
      const req = http.get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
        status = res.statusCode;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status, body, aborted: false }));
        res.on('aborted', () => resolve({ status, body, aborted: true }));
        res.on('error', () => resolve({ status, body, aborted: true }));
      });
      req.on('error', () => resolve({ status, body, aborted: true }));
    });
  }

  it('encerra a conexão sem tentar mandar o JSON de erro e registra o erro uma vez', async () => {
    const res = await rawGet('/teste-falha-no-meio');
    await vi.waitFor(() => expect(loggerError).toHaveBeenCalled());

    // O status e o pedaço já escrito podem nem chegar: o destroy pode correr
    // antes de o Node descarregar o buffer. O que importa: a conexão termina
    // sem o JSON de erro grudado num corpo text/plain.
    expect(res.aborted).toBe(true);
    expect(res.body).not.toContain('statusCode');
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      'Erro depois do envio dos cabeçalhos em GET /teste-falha-no-meio',
      expect.stringContaining('falha no meio do envio'),
    );
    expect(unhandled).toEqual([]);
  });

  it('continua respondendo depois disso', async () => {
    await rawGet('/teste-falha-no-meio');

    const res = await request(app.getHttpServer()).get('/listings').expect(200);

    expect(res.body).toHaveProperty('items');
  });
});
