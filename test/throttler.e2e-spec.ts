import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DEFAULT_PASSWORD, ERROR_KEYS } from './support/fixtures.js';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
} from './support/test-app.js';

describe('Rate limit real de POST /auth/login (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ realThrottler: true });
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('responde 429 na sexta tentativa seguida, no formato único', async () => {
    const server = app.getHttpServer();
    const body = { email: 'ninguem@x.com', password: DEFAULT_PASSWORD };
    const firstFive: number[] = [];
    for (let n = 0; n < 5; n++) {
      firstFive.push(
        (await request(server).post('/auth/login').send(body)).status,
      );
    }

    const res = await request(server).post('/auth/login').send(body);

    expect(firstFive).toEqual([401, 401, 401, 401, 401]);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Muitas requisições. Tente novamente em instantes.',
      path: '/auth/login',
    });
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
  });

  it('responde o 429 com o code TOO_MANY_REQUESTS, no-store e o Retry-After', async () => {
    const server = app.getHttpServer();
    const body = { email: 'ninguem@x.com', password: DEFAULT_PASSWORD };
    for (let n = 0; n < 5; n++) {
      await request(server).post('/auth/login').send(body);
    }

    const res = await request(server).post('/auth/login').send(body);

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Muitas requisições. Tente novamente em instantes.',
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
