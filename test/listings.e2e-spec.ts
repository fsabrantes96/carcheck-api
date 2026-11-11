import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  ERROR_KEYS,
  listingPayload,
  registerAndLogin,
  VALIDATION_ERROR_KEYS,
} from './support/fixtures.js';
import type { TestUser } from './support/fixtures.js';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
} from './support/test-app.js';

describe('Listings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let seller: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    seller = await registerAndLogin(app, 'vendedor@x.com', 'Carlos Vendedor');
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  async function createListing(
    payload: ReturnType<typeof listingPayload> = listingPayload(),
    token = seller.token,
  ): Promise<{ id: string }> {
    const res = await request(app.getHttpServer())
      .post('/listings')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(201);
    return res.body as { id: string };
  }

  describe('POST /listings', () => {
    it('cria o anúncio com 201, status ACTIVE, os dados do veículo e sem sellerId', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send(listingPayload())
        .expect(201);

      expect(res.body).not.toHaveProperty('sellerId');
      expect(res.body).toMatchObject({
        sellerName: 'Carlos Vendedor',
        title: 'Gol 1.0 2018 completo',
        priceCents: 4_500_000,
        status: 'ACTIVE',
        vehicle: { brand: 'Volkswagen', model: 'Gol', year: 2018 },
      });
      expect(await prisma.listing.count()).toBe(1);
    });
  });

  describe('GET /listings', () => {
    it('filtra por marca, cidade e faixa de preço', async () => {
      const match = await createListing(
        listingPayload({
          brand: 'Fiat',
          city: 'Sorocaba',
          priceCents: 3_000_000,
        }),
      );
      await createListing(
        listingPayload({
          brand: 'Volkswagen',
          city: 'Sorocaba',
          priceCents: 3_000_000,
        }),
      );
      await createListing(
        listingPayload({
          brand: 'Fiat',
          city: 'Boituva',
          priceCents: 3_000_000,
        }),
      );
      await createListing(
        listingPayload({
          brand: 'Fiat',
          city: 'Sorocaba',
          priceCents: 9_000_000,
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/listings')
        .query({
          brand: 'fiat',
          city: 'sorocaba',
          minPriceCents: 1_000_000,
          maxPriceCents: 5_000_000,
        })
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items.map((l: { id: string }) => l.id)).toEqual([
        match.id,
      ]);
    });

    it('pagina com page e limit e devolve o total de todos os itens', async () => {
      const created: string[] = [];
      for (let n = 1; n <= 5; n++) {
        created.push(
          (
            await createListing(
              listingPayload({ title: `Anúncio número ${n}` }),
            )
          ).id,
        );
      }

      const pages = await Promise.all(
        [1, 2, 3].map((page) =>
          request(app.getHttpServer())
            .get('/listings')
            .query({ page, limit: 2 })
            .expect(200),
        ),
      );

      expect(pages.map((p) => p.body.items.length)).toEqual([2, 2, 1]);
      expect(pages[2].body).toMatchObject({ total: 5, page: 3, limit: 2 });
      const seen = pages.flatMap((p) =>
        p.body.items.map((l: { id: string }) => l.id),
      );
      expect(new Set(seen)).toEqual(new Set(created));
    });

    it('responde 400 no formato de validação com limit=51', async () => {
      const res = await request(app.getHttpServer())
        .get('/listings')
        .query({ limit: 51 })
        .expect(400);

      expect(res.body.message).toBe('Dados inválidos');
      expect(Object.keys(res.body).sort()).toEqual(VALIDATION_ERROR_KEYS);
      expect(res.body.errors).toEqual(['limit must not be greater than 50']);
    });
  });

  describe('PATCH /listings/:id com status', () => {
    it('responde 400 (campo não permitido) e não altera o status do anúncio', async () => {
      const listing = await createListing();

      const res = await request(app.getHttpServer())
        .patch(`/listings/${listing.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ status: 'PAUSED' })
        .expect(400);

      expect(res.body.message).toBe('Dados inválidos');
      expect(Object.keys(res.body).sort()).toEqual(VALIDATION_ERROR_KEYS);
      expect(res.body.errors).toEqual(['property status should not exist']);
      const saved = await prisma.listing.findUniqueOrThrow({
        where: { id: listing.id },
      });
      expect(saved.status).toBe('ACTIVE');
    });
  });

  describe('ownership', () => {
    let other: TestUser;
    let listingId: string;

    beforeEach(async () => {
      other = await registerAndLogin(app, 'outro@x.com', 'Outro Usuário');
      listingId = (await createListing()).id;
    });

    it('responde 403 "Este anúncio não pertence a você" ao PATCH de outro usuário e não altera o anúncio', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/listings/${listingId}`)
        .set('Authorization', `Bearer ${other.token}`)
        .send({ title: 'Título trocado por outro' })
        .expect(403);

      expect(res.body.message).toBe('Este anúncio não pertence a você');
      expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
      const saved = await prisma.listing.findUniqueOrThrow({
        where: { id: listingId },
      });
      expect(saved.title).toBe('Gol 1.0 2018 completo');
    });

    it('responde 403 "Este anúncio não pertence a você" ao DELETE de outro usuário e mantém o anúncio', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/listings/${listingId}`)
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);

      expect(res.body.message).toBe('Este anúncio não pertence a você');
      expect(await prisma.listing.count({ where: { id: listingId } })).toBe(1);
    });

    it('o dono arquiva com 204: o anúncio continua no banco com status ARCHIVED e o veículo é mantido', async () => {
      await request(app.getHttpServer())
        .delete(`/listings/${listingId}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .expect(204);

      const saved = await prisma.listing.findUniqueOrThrow({
        where: { id: listingId },
      });
      expect(saved.status).toBe('ARCHIVED');
      expect(await prisma.vehicleDetails.count({ where: { listingId } })).toBe(
        1,
      );
    });
  });

  type TransitionRoute = 'pause' | 'activate' | 'mark-sold';
  type ListingAction = TransitionRoute | 'archive';
  type Status = 'ACTIVE' | 'PAUSED' | 'SOLD' | 'ARCHIVED';

  const INVALID_TRANSITION = 'Ação não permitida no status atual do anúncio';
  const RACE_CONFLICT =
    'O anúncio mudou de status; recarregue e tente novamente';

  /** Dispara a ação de ciclo de vida (archive = DELETE) sem conferir o status HTTP. */
  function runAction(id: string, action: ListingAction, token = seller.token) {
    const server = app.getHttpServer();
    const req =
      action === 'archive'
        ? request(server).delete(`/listings/${id}`)
        : request(server).post(`/listings/${id}/${action}`);
    return req.set('Authorization', `Bearer ${token}`);
  }

  /** Caminho pela API para levar um anúncio ACTIVE até cada status. */
  const PATH_TO: Record<Status, ListingAction[]> = {
    ACTIVE: [],
    PAUSED: ['pause'],
    SOLD: ['mark-sold'],
    ARCHIVED: ['archive'],
  };

  async function createListingIn(status: Status): Promise<string> {
    const { id } = await createListing();
    for (const action of PATH_TO[status]) {
      const res = await runAction(id, action);
      expect([200, 204]).toContain(res.status);
    }
    return id;
  }

  async function statusInDb(id: string): Promise<string> {
    const saved = await prisma.listing.findUniqueOrThrow({ where: { id } });
    return saved.status;
  }

  async function publicIds(): Promise<string[]> {
    const res = await request(app.getHttpServer()).get('/listings').expect(200);
    return res.body.items.map((l: { id: string }) => l.id);
  }

  async function mine(): Promise<{ id: string; status: string }[]> {
    const res = await request(app.getHttpServer())
      .get('/listings/mine')
      .set('Authorization', `Bearer ${seller.token}`)
      .expect(200);
    return res.body as { id: string; status: string }[];
  }

  describe('arquivamento (DELETE /listings/:id)', () => {
    let archivedId: string;
    let keptId: string;

    beforeEach(async () => {
      archivedId = (await createListing()).id;
      keptId = (
        await createListing(
          listingPayload({ title: 'Outro anúncio do mesmo dono' }),
        )
      ).id;
      await runAction(archivedId, 'archive').expect(204);
    });

    it('o anúncio arquivado some de GET /listings e o outro anúncio continua', async () => {
      const res = await request(app.getHttpServer())
        .get('/listings')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items.map((l: { id: string }) => l.id)).toEqual([keptId]);
    });

    it('GET /listings/:id do anúncio arquivado responde 404 "Anúncio não encontrado"', async () => {
      const res = await request(app.getHttpServer())
        .get(`/listings/${archivedId}`)
        .expect(404);

      expect(res.body.message).toBe('Anúncio não encontrado');
      expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
    });

    it('GET /listings/mine não traz o arquivado e mantém o outro anúncio do dono', async () => {
      const items = await mine();

      expect(items.map((l) => l.id)).toEqual([keptId]);
    });

    it('PATCH no anúncio arquivado responde 409 "Anúncio arquivado não pode ser alterado" e não altera o título', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/listings/${archivedId}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ title: 'Título novo depois de arquivar' })
        .expect(409);

      expect(res.body.message).toBe('Anúncio arquivado não pode ser alterado');
      expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
      const saved = await prisma.listing.findUniqueOrThrow({
        where: { id: archivedId },
      });
      expect(saved.title).toBe('Gol 1.0 2018 completo');
      expect(saved.status).toBe('ARCHIVED');
    });
  });

  describe('pause e activate: visibilidade', () => {
    let listingId: string;

    beforeEach(async () => {
      listingId = (await createListing()).id;
    });

    it('pause responde 200 com status PAUSED, sem sellerId', async () => {
      const res = await runAction(listingId, 'pause').expect(200);

      expect(res.body).toMatchObject({ id: listingId, status: 'PAUSED' });
      expect(res.body).not.toHaveProperty('sellerId');
    });

    it('anúncio pausado some de GET /listings', async () => {
      await runAction(listingId, 'pause').expect(200);

      expect(await publicIds()).toEqual([]);
    });

    it('GET /listings/:id do anúncio pausado responde 404 "Anúncio não encontrado"', async () => {
      await runAction(listingId, 'pause').expect(200);

      const res = await request(app.getHttpServer())
        .get(`/listings/${listingId}`)
        .expect(404);

      expect(res.body.message).toBe('Anúncio não encontrado');
    });

    it('anúncio pausado aparece em GET /listings/mine com status PAUSED', async () => {
      await runAction(listingId, 'pause').expect(200);

      expect(await mine()).toEqual([
        expect.objectContaining({ id: listingId, status: 'PAUSED' }),
      ]);
    });

    it('activate volta o anúncio pausado para ACTIVE e ele reaparece em GET /listings e GET /listings/:id', async () => {
      await runAction(listingId, 'pause').expect(200);

      const res = await runAction(listingId, 'activate').expect(200);

      expect(res.body).toMatchObject({ id: listingId, status: 'ACTIVE' });
      expect(await publicIds()).toEqual([listingId]);
      await request(app.getHttpServer())
        .get(`/listings/${listingId}`)
        .expect(200);
    });
  });

  describe('máquina de estados (todas as combinações status x ação)', () => {
    const allowed: [Status, ListingAction, number, Status][] = [
      ['ACTIVE', 'pause', 200, 'PAUSED'],
      ['ACTIVE', 'mark-sold', 200, 'SOLD'],
      ['ACTIVE', 'archive', 204, 'ARCHIVED'],
      ['PAUSED', 'activate', 200, 'ACTIVE'],
      ['PAUSED', 'mark-sold', 200, 'SOLD'],
      ['PAUSED', 'archive', 204, 'ARCHIVED'],
      ['SOLD', 'archive', 204, 'ARCHIVED'],
    ];

    const forbidden: [Status, ListingAction][] = [
      ['ACTIVE', 'activate'],
      ['PAUSED', 'pause'],
      ['SOLD', 'pause'],
      ['SOLD', 'activate'],
      ['SOLD', 'mark-sold'],
      ['ARCHIVED', 'pause'],
      ['ARCHIVED', 'activate'],
      ['ARCHIVED', 'mark-sold'],
      ['ARCHIVED', 'archive'],
    ];

    it.each(allowed)(
      'em %s, a ação %s responde %i e o status no banco passa a %s',
      async (from, action, httpStatus, to) => {
        const id = await createListingIn(from);

        await runAction(id, action).expect(httpStatus);

        expect(await statusInDb(id)).toBe(to);
      },
    );

    it.each(allowed.filter(([, , httpStatus]) => httpStatus === 200))(
      'em %s, a ação %s devolve o anúncio do dono com o novo status, sem sellerId',
      async (from, action, _httpStatus, to) => {
        const id = await createListingIn(from);

        const res = await runAction(id, action).expect(200);

        expect(res.body).toMatchObject({ id, status: to });
        expect(res.body).not.toHaveProperty('sellerId');
      },
    );

    it.each(forbidden)(
      'em %s, a ação %s responde 409 "Ação não permitida no status atual do anúncio" e o status não muda',
      async (from, action) => {
        const id = await createListingIn(from);

        const res = await runAction(id, action).expect(409);

        expect(res.body.message).toBe(INVALID_TRANSITION);
        expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
        expect(await statusInDb(id)).toBe(from);
      },
    );
  });

  describe('rotas de transição: ownership e entradas', () => {
    const routes: TransitionRoute[] = ['pause', 'activate', 'mark-sold'];
    let listingId: string;

    beforeEach(async () => {
      listingId = (await createListing()).id;
    });

    it.each(routes)(
      'POST /listings/:id/%s de outro usuário responde 403 "Este anúncio não pertence a você" e o status não muda',
      async (route) => {
        const other = await registerAndLogin(
          app,
          'outro@x.com',
          'Outro Usuário',
        );

        const res = await runAction(listingId, route, other.token).expect(403);

        expect(res.body.message).toBe('Este anúncio não pertence a você');
        expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
        expect(await statusInDb(listingId)).toBe('ACTIVE');
      },
    );

    it.each(routes)(
      'POST /listings/:id/%s com uuid inexistente responde 404 "Anúncio não encontrado"',
      async (route) => {
        const res = await runAction(
          '00000000-0000-4000-8000-000000000000',
          route,
        ).expect(404);

        expect(res.body.message).toBe('Anúncio não encontrado');
        expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
      },
    );

    it.each(routes)(
      'POST /listings/:id/%s sem token responde 401 "Token não informado" e o status não muda',
      async (route) => {
        const res = await request(app.getHttpServer())
          .post(`/listings/${listingId}/${route}`)
          .expect(401);

        expect(res.body.message).toBe('Token não informado');
        expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
        expect(await statusInDb(listingId)).toBe('ACTIVE');
      },
    );

    it.each(routes)(
      'POST /listings/:id/%s com id que não é uuid responde 400',
      async (route) => {
        const res = await runAction('nao-e-uuid', route).expect(400);

        expect(res.body.message).toBe('Validation failed (uuid is expected)');
        expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
      },
    );
  });

  describe('concorrência', () => {
    const ROUNDS = 10;
    const CONFLICT_MESSAGES = [RACE_CONFLICT, INVALID_TRANSITION];

    /** Status final esperado para cada par de respostas `pause-markSold`. */
    const FINAL_BY_OUTCOME: Record<string, Status> = {
      '200-200': 'SOLD', // pause chegou antes; PAUSED -> SOLD é permitido
      '200-409': 'PAUSED',
      '409-200': 'SOLD',
    };

    it(`pause e mark-sold simultâneos (${ROUNDS} rodadas) nunca dão 500 e deixam um estado coerente`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { id } = await createListing();

        const [paused, sold] = await Promise.all([
          runAction(id, 'pause'),
          runAction(id, 'mark-sold'),
        ]);

        const outcome = `${paused.status}-${sold.status}`;
        expect(Object.keys(FINAL_BY_OUTCOME)).toContain(outcome);
        expect(await statusInDb(id)).toBe(FINAL_BY_OUTCOME[outcome]);
        const conflictMessages = [paused, sold]
          .filter((r) => r.status === 409)
          .map((r) => r.body.message as string);
        expect(
          conflictMessages.every((m) => CONFLICT_MESSAGES.includes(m)),
        ).toBe(true);
      }
    });

    it(`dois DELETE simultâneos (${ROUNDS} rodadas): um 204, um 409 e status final ARCHIVED`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const { id } = await createListing();

        const responses = await Promise.all([
          runAction(id, 'archive'),
          runAction(id, 'archive'),
        ]);

        expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
          204, 409,
        ]);
        const conflict = responses.find((r) => r.status === 409);
        expect(CONFLICT_MESSAGES).toContain(conflict?.body.message);
        expect(await statusInDb(id)).toBe('ARCHIVED');
      }
    });
  });

  describe('contrato no /docs-json', () => {
    type OpenApiDoc = {
      paths: Record<string, Record<string, unknown>>;
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
    };
    let doc: OpenApiDoc;

    function schemaProps(name: string): string[] {
      return Object.keys(doc.components.schemas[name]?.properties ?? {});
    }

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .get('/docs-json')
        .expect(200);
      doc = res.body as OpenApiDoc;
    });

    it('ListingResponseDto (resposta pública) não tem sellerId nem status', () => {
      const props = schemaProps('ListingResponseDto');

      expect(props).toContain('id');
      expect(props).not.toContain('sellerId');
      expect(props).not.toContain('status');
    });

    it('MyListingResponseDto (resposta do dono) tem status e não tem sellerId', () => {
      const props = schemaProps('MyListingResponseDto');

      expect(props).toContain('status');
      expect(props).not.toContain('sellerId');
    });

    it('UpdateListingDto não tem status', () => {
      const props = schemaProps('UpdateListingDto');

      expect(props).toContain('title');
      expect(props).not.toContain('status');
    });

    it.each(['pause', 'activate', 'mark-sold'])(
      'a rota POST /listings/{id}/%s existe',
      (route) => {
        expect(doc.paths[`/listings/{id}/${route}`]).toHaveProperty('post');
      },
    );
  });
});
