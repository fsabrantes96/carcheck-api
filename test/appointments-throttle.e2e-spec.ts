import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ERROR_KEYS, hoursFromNow, listingPayload, registerAndLogin, verifiedInspector } from './support/fixtures.js';
import { closeTestApp, createTestApp, resetDatabase } from './support/test-app.js';

/**
 * Limite real de 10/min em POST /appointments (risco 28). Os usuários são
 * criados numa app com limites altos (cadastro e login têm 5/min) e os tokens
 * são usados na app com o throttler real: as duas usam o mesmo JWT_SECRET e
 * o mesmo banco.
 */
describe('Rate limit real de POST /appointments (e2e)', () => {
  let seedApp: INestApplication<App>;
  let app: INestApplication<App>;

  beforeAll(async () => {
    seedApp = await createTestApp();
    app = await createTestApp({ realThrottler: true });
  });

  beforeEach(async () => {
    await resetDatabase(seedApp);
  });

  afterAll(async () => {
    await closeTestApp(app);
    await closeTestApp(seedApp);
  });

  it('responde 429 na 11ª requisição do mesmo IP no minuto, no formato único', async () => {
    const seller = await registerAndLogin(seedApp, 'vendedor@x.com', 'Vera Vendedora');
    const buyer = await registerAndLogin(seedApp, 'comprador@x.com', 'Bruno Comprador');
    const inspector = await verifiedInspector(seedApp, 'avaliador@x.com', 'Ivo Avaliador');
    const listing = await request(seedApp.getHttpServer())
      .post('/listings')
      .set('Authorization', `Bearer ${seller.token}`)
      .send(listingPayload())
      .expect(201);
    const body = { listingId: listing.body.id, inspectorProfileId: inspector.profileId, startsAt: hoursFromNow(48) };
    const send = () =>
      request(app.getHttpServer()).post('/appointments').set('Authorization', `Bearer ${buyer.token}`).send(body);
    const firstTen: number[] = [];
    for (let n = 0; n < 10; n++) firstTen.push((await send()).status);

    const res = await send();

    // O primeiro cria; os seguintes são o mesmo pedido em andamento (409).
    expect(firstTen).toEqual([201, ...Array<number>(9).fill(409)]);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Muitas requisições. Tente novamente em instantes.',
      path: '/appointments',
    });
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
  });
});
