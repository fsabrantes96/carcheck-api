import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { ErrorCode } from '../src/common/errors/error-code.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  ERROR_KEYS,
  registerAndLogin,
  VALIDATION_ERROR_KEYS,
} from './support/fixtures.js';
import { deadlockFromRawQuery } from './support/prisma-error-fixtures.js';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
} from './support/test-app.js';

/**
 * Um caso por code genérico do contrato de erros (ErrorCode): status, code,
 * mensagem, Cache-Control e Content-Type. O 429 está em
 * test/throttler.e2e-spec.ts (storage real) e o 500 em
 * test/errors.e2e-spec.ts (banco indisponível). BAD_REQUEST e
 * METHOD_NOT_ALLOWED não têm gatilho pelo cliente hoje e ficam nos unitários.
 */
describe('Codes genéricos de erro (e2e)', () => {
  let app: INestApplication<App>;
  const ASSET = '/docs/swagger-ui.css';

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function expectCoded(
    res: request.Response,
    statusCode: number,
    code: ErrorCode,
    message: string,
    keys: string[] = ERROR_KEYS,
  ) {
    expect(res.status).toBe(statusCode);
    expect(res.body).toMatchObject({ statusCode, code, message });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(Object.keys(res.body).sort()).toEqual(keys);
  }

  const server = () => request(app.getHttpServer());

  it('VALIDATION_FAILED: 400 de validação do corpo', async () => {
    const res = await server().post('/auth/login').send({});

    expectCoded(res, 400, 'VALIDATION_FAILED', 'Dados inválidos', VALIDATION_ERROR_KEYS);
  });

  it('INVALID_ID: :id que não é uuid', async () => {
    const res = await server().get('/listings/abc');

    expectCoded(res, 400, 'INVALID_ID', 'Identificador inválido');
  });

  it('INVALID_URL_PARAM: parâmetro com codificação inválida', async () => {
    const res = await server().get('/listings/%FF');

    expectCoded(res, 400, 'INVALID_URL_PARAM', 'Parâmetro inválido na URL');
  });

  it('INVALID_BODY: JSON malformado', async () => {
    const res = await server()
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');

    expectCoded(res, 400, 'INVALID_BODY', 'Corpo da requisição inválido');
  });

  it('UNAUTHENTICATED: rota protegida sem token', async () => {
    const res = await server().get('/listings/mine');

    expectCoded(res, 401, 'UNAUTHENTICATED', 'Token não informado');
  });

  it('FORBIDDEN: rota com @Roles para quem não tem a role', async () => {
    const user = await registerAndLogin(app, 'comprador@x.com');

    const res = await server()
      .get('/inspectors/me')
      .set('Authorization', `Bearer ${user.token}`);

    expectCoded(res, 403, 'FORBIDDEN', 'Sem permissão para esta ação');
  });

  it('ROUTE_NOT_FOUND: rota inexistente', async () => {
    const res = await server().get('/nao-existe');

    expectCoded(res, 404, 'ROUTE_NOT_FOUND', 'Rota não encontrada');
  });

  it.each([
    ['NOT_FOUND', 'P2025', 404, 'Registro não encontrado'],
    ['CONFLICT', 'P2002', 409, 'Registro já existe'],
  ] as const)('%s: erro %s do Prisma', async (code, prismaCode, status, message) => {
    vi.spyOn(app.get(PrismaService), '$transaction').mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('erro do prisma', {
        code: prismaCode,
        clientVersion: 'test',
      }),
    );

    const res = await server().get('/listings');

    expectCoded(res, status, code, message);
  });

  it('TRANSACTION_CONFLICT: deadlock no banco', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(app.get(PrismaService), '$transaction').mockRejectedValueOnce(
      deadlockFromRawQuery(),
    );

    const res = await server().get('/listings');

    expectCoded(res, 409, 'TRANSACTION_CONFLICT', 'Conflito ao processar, tente novamente');
  });

  it('PRECONDITION_FAILED: If-Match que não casa num asset do /docs', async () => {
    const res = await server().get(ASSET).set('If-Match', '"x"');

    expectCoded(res, 412, 'PRECONDITION_FAILED', 'Pré-condição da requisição não atendida');
  });

  it('PAYLOAD_TOO_LARGE: corpo acima do limite', async () => {
    const res = await server()
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(200 * 1024) }));

    expectCoded(res, 413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisição muito grande');
  });

  it.each([
    ['Content-Type', { 'Content-Type': 'text/plain' }],
    ['Content-Encoding', { 'Content-Type': 'application/json', 'Content-Encoding': 'xpto' }],
    ['charset', { 'Content-Type': 'application/json; charset=latin9' }],
  ])('UNSUPPORTED_MEDIA_TYPE: %s não suportado', async (_caso, headers) => {
    const res = await server().post('/auth/login').set(headers).send('{}');

    expectCoded(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Formato da requisição não suportado');
  });

  it('RANGE_NOT_SATISFIABLE: Range inválido num asset do /docs', async () => {
    const res = await server().get(ASSET).set('Range', 'bytes=99999999-');

    expectCoded(res, 416, 'RANGE_NOT_SATISFIABLE', 'Intervalo solicitado inválido');
  });
});
