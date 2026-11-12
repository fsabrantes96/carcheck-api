import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  inspectorProfilePayload,
  registerAndLogin,
} from './support/fixtures.js';
import type { TestUser } from './support/fixtures.js';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
} from './support/test-app.js';

describe('Inspectors (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    user = await registerAndLogin(app, 'avaliador@x.com', 'João Avaliador');
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function createProfile() {
    return request(app.getHttpServer())
      .post('/inspectors/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send(inspectorProfilePayload);
  }

  it('cria o perfil com 201 e verified = false', async () => {
    const res = await createProfile().expect(201);

    expect(res.body).toMatchObject({
      name: 'João Avaliador',
      city: 'Barretos',
      basePriceCents: 15000,
      verified: false,
    });
  });

  it('não lista em GET /inspectors um perfil recém-criado (não verificado)', async () => {
    await createProfile().expect(201);

    const res = await request(app.getHttpServer())
      .get('/inspectors')
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('lista em GET /inspectors o perfil depois de marcado como verificado no banco', async () => {
    const created = await createProfile().expect(201);
    await prisma.inspectorProfile.update({
      where: { id: created.body.id },
      data: { verified: true },
    });

    const res = await request(app.getHttpServer())
      .get('/inspectors')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: created.body.id, verified: true });
  });

  it('responde 403 em GET /inspectors/me para usuário sem a role INSPECTOR', async () => {
    const res = await request(app.getHttpServer())
      .get('/inspectors/me')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(403);

    expect(res.body.message).toBe('Sem permissão para esta ação');
  });

  it('libera GET /inspectors/me com o mesmo token logo depois de criar o perfil (role lida do banco)', async () => {
    await request(app.getHttpServer())
      .get('/inspectors/me')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(403);
    const created = await createProfile().expect(201);

    const res = await request(app.getHttpServer())
      .get('/inspectors/me')
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);

    expect(res.body.id).toBe(created.body.id);
  });

  it('criações simultâneas do perfil dão um 201 e um 409, sem duplicar a role (risco 19)', async () => {
    const responses = await Promise.all([createProfile(), createProfile()]);

    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    const conflict = responses.find((r) => r.status === 409);
    expect(conflict?.body.message).toBe('Você já possui perfil de avaliador');
    expect(
      await prisma.inspectorProfile.count({ where: { userId: user.id } }),
    ).toBe(1);
    const saved = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(saved.roles).toEqual(['USER', 'INSPECTOR']);
  });

  describe('comissão por perfil', () => {
    it('GET /inspectors/me traz platformFeeBps 1000 e estimatedPayoutCents 13500', async () => {
      await createProfile().expect(201);

      const res = await request(app.getHttpServer())
        .get('/inspectors/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(res.body).toMatchObject({
        basePriceCents: 15000,
        platformFeeBps: 1000,
        estimatedPayoutCents: 13500,
      });
    });

    it('GET /inspectors (lista pública) não traz platformFeeBps nem estimatedPayoutCents', async () => {
      const created = await createProfile().expect(201);
      await prisma.inspectorProfile.update({
        where: { id: created.body.id },
        data: { verified: true },
      });

      const res = await request(app.getHttpServer())
        .get('/inspectors')
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).not.toHaveProperty('platformFeeBps');
      expect(res.body[0]).not.toHaveProperty('estimatedPayoutCents');
    });

    it('POST /inspectors/me com basePriceCents 4999 responde 400 e não cria o perfil', async () => {
      const res = await request(app.getHttpServer())
        .post('/inspectors/me')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ ...inspectorProfilePayload, basePriceCents: 4999 })
        .expect(400);

      expect(res.body.message).toBe(
        'O preço base precisa ser de pelo menos 5000 centavos (R$ 50,00)',
      );
      expect(
        await prisma.inspectorProfile.count({ where: { userId: user.id } }),
      ).toBe(0);
    });
  });
});
