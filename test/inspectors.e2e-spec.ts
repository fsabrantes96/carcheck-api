import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  inspectorProfilePayload,
  registerAndLogin,
  VALIDATION_ERROR_KEYS,
  verifiedInspector,
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

    expect(res.body).toEqual({ items: [], total: 0, page: 1, limit: 20 });
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

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: created.body.id,
      verified: true,
    });
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

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).not.toHaveProperty('platformFeeBps');
      expect(res.body.items[0]).not.toHaveProperty('estimatedPayoutCents');
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

  describe('GET /inspectors paginado (risco 10)', () => {
    const SAME_INSTANT = new Date('2026-11-10T12:00:00.000Z');

    function list(query: Record<string, unknown> = {}) {
      return request(app.getHttpServer()).get('/inspectors').query(query);
    }

    /** Cria avaliadores verificados e devolve os ids de perfil. */
    async function verifiedMany(count: number): Promise<string[]> {
      const ids: string[] = [];
      for (let n = 1; n <= count; n++) {
        ids.push(
          (
            await verifiedInspector(
              app,
              `verificado${n}@x.com`,
              `Avaliador ${n}`,
            )
          ).profileId,
        );
      }
      return ids;
    }

    it('responde { items, total, page, limit } com os padrões page 1 e limit 20', async () => {
      await verifiedMany(1);

      const res = await list().expect(200);

      expect(Object.keys(res.body).sort()).toEqual([
        'items',
        'limit',
        'page',
        'total',
      ]);
      expect(res.body).toMatchObject({ total: 1, page: 1, limit: 20 });
      expect(res.body.items).toHaveLength(1);
    });

    it('pagina com page e limit sem repetir nem perder perfis, e o total conta todos', async () => {
      const ids = await verifiedMany(5);

      const pages = await Promise.all(
        [1, 2, 3].map((page) => list({ page, limit: 2 }).expect(200)),
      );

      expect(pages.map((p) => p.body.items.length)).toEqual([2, 2, 1]);
      expect(pages.map((p) => p.body.total)).toEqual([5, 5, 5]);
      expect(pages[2].body).toMatchObject({ page: 3, limit: 2 });
      const seen = pages.flatMap((p) =>
        p.body.items.map((i: { id: string }) => i.id),
      );
      expect(new Set(seen)).toEqual(new Set(ids));
      expect(seen).toHaveLength(5);
    });

    it('página além do fim responde 200 com items vazio e o total', async () => {
      await verifiedMany(3);

      const res = await list({ page: 10, limit: 2 }).expect(200);

      expect(res.body).toEqual({ items: [], total: 3, page: 10, limit: 2 });
    });

    it('aceita os limites page=200 e limit=50', async () => {
      const res = await list({ page: 200, limit: 50 }).expect(200);

      expect(res.body).toEqual({ items: [], total: 0, page: 200, limit: 50 });
    });

    it('aceita os limites page=1 e limit=1', async () => {
      await verifiedMany(2);

      const res = await list({ page: 1, limit: 1 }).expect(200);

      expect(res.body).toMatchObject({ total: 2, page: 1, limit: 1 });
      expect(res.body.items).toHaveLength(1);
    });

    it.each([
      [{ page: 0 }, 'page must not be less than 1'],
      [{ page: 201 }, 'page must not be greater than 200'],
      [{ limit: 0 }, 'limit must not be less than 1'],
      [{ limit: 51 }, 'limit must not be greater than 50'],
      [{ page: 1.5 }, 'page must be an integer number'],
      [{ limit: 'abc' }, 'limit must be an integer number'],
    ])('responde 400 no formato de validação com %o', async (query, error) => {
      const res = await list(query).expect(400);

      expect(res.body.message).toBe('Dados inválidos');
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body).sort()).toEqual(VALIDATION_ERROR_KEYS);
      expect(res.body.errors).toContain(error);
    });

    it('continua listando só os verificados: o não verificado não entra nos itens nem no total', async () => {
      const verified = await verifiedMany(2);
      await createProfile().expect(201);

      const res = await list().expect(200);

      expect(res.body.total).toBe(2);
      expect(new Set(res.body.items.map((i: { id: string }) => i.id))).toEqual(
        new Set(verified),
      );
    });

    it('ordena por createdAt desc', async () => {
      const [older, newer] = await verifiedMany(2);
      await prisma.inspectorProfile.update({
        where: { id: older },
        data: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
      });
      await prisma.inspectorProfile.update({
        where: { id: newer },
        data: { createdAt: new Date('2026-02-01T00:00:00.000Z') },
      });

      const res = await list().expect(200);

      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([
        newer,
        older,
      ]);
    });

    it('com createdAt empatado, limit=1 percorre os perfis em id desc, sem repetir, e repete a mesma ordem', async () => {
      await verifiedMany(5);
      await prisma.inspectorProfile.updateMany({
        data: { createdAt: SAME_INSTANT },
      });
      // A ordem esperada é a do próprio banco por id desc (colação do Postgres).
      const expected = (
        await prisma.inspectorProfile.findMany({
          orderBy: { id: 'desc' },
          select: { id: true },
        })
      ).map((p) => p.id);

      const walk = async () => {
        const ids: string[] = [];
        for (let page = 1; page <= 5; page++) {
          const res = await list({ page, limit: 1 }).expect(200);
          ids.push(...res.body.items.map((i: { id: string }) => i.id));
        }
        return ids;
      };

      expect(await walk()).toEqual(expected);
      expect(await walk()).toEqual(expected);
    });
  });
});
