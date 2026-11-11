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
    it('cria o anúncio com 201, status ACTIVE e os dados do veículo', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .set('Authorization', `Bearer ${seller.token}`)
        .send(listingPayload())
        .expect(201);

      expect(res.body).toMatchObject({
        sellerId: seller.id,
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

  describe('PATCH /listings/:id com status PAUSED', () => {
    it('tira o anúncio de GET /listings e faz GET /listings/:id responder 404', async () => {
      const listing = await createListing();
      await request(app.getHttpServer())
        .get(`/listings/${listing.id}`)
        .expect(200);

      const patched = await request(app.getHttpServer())
        .patch(`/listings/${listing.id}`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ status: 'PAUSED' })
        .expect(200);
      expect(patched.body.status).toBe('PAUSED');

      const list = await request(app.getHttpServer())
        .get('/listings')
        .expect(200);
      expect(list.body).toMatchObject({ items: [], total: 0 });
      const one = await request(app.getHttpServer())
        .get(`/listings/${listing.id}`)
        .expect(404);
      expect(one.body.message).toBe('Anúncio não encontrado');
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
});
