import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { DEFAULT_PASSWORD, registerAndLogin } from './support/fixtures.js';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
} from './support/test-app.js';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('POST /auth/register', () => {
    it('cadastra com 201 e não devolve passwordHash', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Maria',
          email: 'maria@x.com',
          password: DEFAULT_PASSWORD,
        })
        .expect(201);

      expect(res.body).toMatchObject({ name: 'Maria', email: 'maria@x.com' });
      expect(typeof res.body.id).toBe('string');
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain(DEFAULT_PASSWORD);
    });

    it('grava o e-mail com trim e minúsculas', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Maria',
          email: '  Maria@X.com ',
          password: DEFAULT_PASSWORD,
        })
        .expect(201);

      expect(res.body.email).toBe('maria@x.com');
      const saved = await prisma.user.findMany({ select: { email: true } });
      expect(saved).toEqual([{ email: 'maria@x.com' }]);
    });

    it('cadastros simultâneos com o mesmo e-mail dão um 201 e um 409, nunca 500 (risco 19)', async () => {
      const server = app.getHttpServer();
      const body = {
        name: 'Maria',
        email: 'corrida@x.com',
        password: DEFAULT_PASSWORD,
      };

      const responses = await Promise.all([
        request(server).post('/auth/register').send(body),
        request(server).post('/auth/register').send(body),
      ]);

      const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);
      const conflict = responses.find((r) => r.status === 409);
      expect(conflict?.body.message).toBe('E-mail já cadastrado');
      expect(
        await prisma.user.count({ where: { email: 'corrida@x.com' } }),
      ).toBe(1);
    });
  });

  describe('POST /auth/login', () => {
    it('devolve 200 com accessToken', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Maria',
          email: 'maria@x.com',
          password: DEFAULT_PASSWORD,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'maria@x.com', password: DEFAULT_PASSWORD })
        .expect(200);

      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.user.email).toBe('maria@x.com');
      expect(res.body.user).not.toHaveProperty('passwordHash');
    });

    it('aceita o e-mail com maiúsculas de uma conta cadastrada com maiúsculas e espaços', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Maria',
          email: '  Maria@X.com ',
          password: DEFAULT_PASSWORD,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'MARIA@x.com', password: DEFAULT_PASSWORD })
        .expect(200);

      expect(res.body.user.email).toBe('maria@x.com');
    });
  });

  describe('GET /auth/me', () => {
    it('devolve os dados do usuário dono do token', async () => {
      const user = await registerAndLogin(app, 'maria@x.com', 'Maria');

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: user.id,
        name: 'Maria',
        email: 'maria@x.com',
      });
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('responde 401 "Token inválido ou expirado" com a assinatura adulterada', async () => {
      const user = await registerAndLogin(app, 'maria@x.com');
      // Troca um caractere do meio da assinatura (o último carrega bits de
      // preenchimento do base64url e nem sempre altera a assinatura).
      const i = user.token.lastIndexOf('.') + 5;
      const swapped = user.token[i] === 'a' ? 'b' : 'a';
      const tampered =
        user.token.slice(0, i) + swapped + user.token.slice(i + 1);

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${tampered}`)
        .expect(401);

      expect(res.body.message).toBe('Token inválido ou expirado');
    });

    it('responde 401 "Token não informado" sem o header Authorization', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);

      expect(res.body.message).toBe('Token não informado');
    });
  });
});
