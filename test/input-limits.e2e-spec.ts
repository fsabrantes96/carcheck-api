import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  DEFAULT_PASSWORD,
  hoursFromNow,
  inspectorProfilePayload,
  listingPayload,
  registerAndLogin,
  VALIDATION_ERROR_KEYS,
  verifiedInspector,
} from './support/fixtures.js';
import type { TestUser } from './support/fixtures.js';
import { closeTestApp, createTestApp, resetDatabase } from './support/test-app.js';

/** Acima do Int de 32 bits do Postgres (2.147.483.647). */
const ABOVE_INT32 = 3_000_000_000;

describe('Limites de entrada (e2e)', () => {
  let app: INestApplication<App>;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    user = await registerAndLogin(app, 'usuario@x.com', 'Ana Usuária');
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

  function expectValidation400(res: request.Response): void {
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Dados inválidos');
    expect(Object.keys(res.body).sort()).toEqual(VALIDATION_ERROR_KEYS);
  }

  async function createListing(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/listings')
      .set(auth(user))
      .send(listingPayload())
      .expect(201);
    return (res.body as { id: string }).id;
  }

  describe('GET /listings: teto de page', () => {
    it('aceita page=200 (o teto) e devolve página vazia', async () => {
      const res = await request(app.getHttpServer()).get('/listings').query({ page: 200 }).expect(200);

      expect(res.body).toMatchObject({ items: [], page: 200 });
    });

    it.each(['201', '1e20'])('responde 400 (não 500) com page=%s', async (page) => {
      const res = await request(app.getHttpServer()).get('/listings').query({ page });

      expectValidation400(res);
      expect(res.body.errors).toEqual(['page must not be greater than 200']);
    });
  });

  describe('números acima do Int de 32 bits respondem 400, nunca 500', () => {
    it('POST /listings com priceCents acima do teto', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .set(auth(user))
        .send(listingPayload({ priceCents: ABOVE_INT32 }));

      expectValidation400(res);
      expect(res.body.errors).toEqual(['priceCents must not be greater than 1000000000']);
    });

    it('POST /listings com vehicle.mileageKm acima do teto', async () => {
      const payload = listingPayload();
      const res = await request(app.getHttpServer())
        .post('/listings')
        .set(auth(user))
        .send({ ...payload, vehicle: { ...payload.vehicle, mileageKm: ABOVE_INT32 } });

      expectValidation400(res);
      expect(res.body.errors).toEqual(['vehicle.mileageKm must not be greater than 2000000']);
    });

    it('POST /inspectors/me com basePriceCents acima do teto', async () => {
      const res = await request(app.getHttpServer())
        .post('/inspectors/me')
        .set(auth(user))
        .send({ ...inspectorProfilePayload, basePriceCents: ABOVE_INT32 });

      expectValidation400(res);
      expect(res.body.errors).toEqual(['basePriceCents must not be greater than 500000']);
    });

    it.each([
      ['minPriceCents', String(ABOVE_INT32), 'minPriceCents must not be greater than 1000000000'],
      ['maxPriceCents', String(ABOVE_INT32), 'maxPriceCents must not be greater than 1000000000'],
      ['minYear', String(ABOVE_INT32), `minYear must not be greater than ${new Date().getFullYear() + 1}`],
      ['minYear', String(-ABOVE_INT32), 'minYear must not be less than 1950'],
      ['maxYear', String(ABOVE_INT32), `maxYear must not be greater than ${new Date().getFullYear() + 1}`],
    ])('GET /listings?%s=%s', async (field, value, message) => {
      const res = await request(app.getHttpServer()).get('/listings').query({ [field]: value });

      expectValidation400(res);
      expect(res.body.errors).toEqual([message]);
    });
  });

  describe('texto acima do limite em cada endpoint de escrita', () => {
    it('POST /auth/register com e-mail de 255 caracteres', async () => {
      const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`;
      expect(email).toHaveLength(255);

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Maria Silva', email, password: DEFAULT_PASSWORD });

      // O @IsEmail do validator.js já recusa mais de 254 caracteres; o
      // @MaxLength deixa o limite explícito na mensagem e no Swagger.
      expectValidation400(res);
      expect(res.body.errors).toEqual(
        expect.arrayContaining(['email must be shorter than or equal to 254 characters']),
      );
    });

    it('POST /auth/register com senha acima de 72 bytes (37 "é" = 74 bytes)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Maria Silva', email: 'maria@x.com', password: 'é'.repeat(37) });

      expectValidation400(res);
      expect(res.body.errors).toEqual(['password deve ter no máximo 72 bytes']);
    });

    it('POST /listings com título de 121 caracteres', async () => {
      const res = await request(app.getHttpServer())
        .post('/listings')
        .set(auth(user))
        .send(listingPayload({ title: 'a'.repeat(121) }));

      expectValidation400(res);
      expect(res.body.errors).toEqual(['title must be shorter than or equal to 120 characters']);
    });

    it('PATCH /listings/:id com descrição de 2001 caracteres', async () => {
      const id = await createListing();

      const res = await request(app.getHttpServer())
        .patch(`/listings/${id}`)
        .set(auth(user))
        .send({ description: 'a'.repeat(2001) });

      expectValidation400(res);
      expect(res.body.errors).toEqual(['description must be shorter than or equal to 2000 characters']);
    });

    it('POST /inspectors/me com bio de 2001 caracteres', async () => {
      const res = await request(app.getHttpServer())
        .post('/inspectors/me')
        .set(auth(user))
        .send({ ...inspectorProfilePayload, bio: 'a'.repeat(2001) });

      expectValidation400(res);
      expect(res.body.errors).toEqual(['bio must be shorter than or equal to 2000 characters']);
    });

    it('PATCH /inspectors/me com cidade de 101 caracteres', async () => {
      const inspector = await verifiedInspector(app, 'avaliador@x.com');

      const res = await request(app.getHttpServer())
        .patch('/inspectors/me')
        .set(auth(inspector))
        .send({ city: 'a'.repeat(101) });

      expectValidation400(res);
      expect(res.body.errors).toEqual(['city must be shorter than or equal to 100 characters']);
    });

    it('POST /appointments/:id/confirm com endereço de 301 caracteres', async () => {
      const inspector = await verifiedInspector(app, 'avaliador@x.com');
      const buyer = await registerAndLogin(app, 'comprador@x.com');
      const listingId = await createListing();
      const created = await request(app.getHttpServer())
        .post('/appointments')
        .set(auth(buyer))
        .send({ listingId, inspectorProfileId: inspector.profileId, startsAt: hoursFromNow(48) })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await request(app.getHttpServer()).post(`/appointments/${id}/accept`).set(auth(inspector)).expect(200);

      const res = await request(app.getHttpServer())
        .post(`/appointments/${id}/confirm`)
        .set(auth(user))
        .send({ meetingAddress: 'a'.repeat(301) });

      expectValidation400(res);
      expect(res.body.errors).toEqual(['meetingAddress must be shorter than or equal to 300 characters']);
    });
  });

  describe('limite do corpo (100kb, explícito)', () => {
    it('um JSON de ~99 KB passa pelo parser e chega à validação (400, não 413)', async () => {
      const body = JSON.stringify({ email: 'maria@x.com', password: DEFAULT_PASSWORD, padding: 'x'.repeat(99 * 1024) });

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json')
        .send(body);

      expectValidation400(res);
      expect(res.body.errors).toEqual(['property padding should not exist']);
    });
  });

  describe('contrato no /docs-json', () => {
    type Schema = { properties: Record<string, Record<string, unknown>> };
    type Param = { name: string; in: string; schema: Record<string, unknown> };
    let doc: {
      components: { schemas: Record<string, Schema> };
      paths: Record<string, Record<string, { parameters?: Param[] }>>;
    };

    beforeEach(async () => {
      const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
      doc = res.body as typeof doc;
    });

    const prop = (schema: string, field: string) => doc.components.schemas[schema].properties[field];

    it.each([
      ['CreateListingDto', 'title', { minLength: 5, maxLength: 120 }],
      ['CreateListingDto', 'description', { minLength: 20, maxLength: 2000 }],
      ['CreateListingDto', 'city', { maxLength: 100 }],
      ['CreateListingDto', 'priceCents', { minimum: 1, maximum: 1_000_000_000 }],
      ['UpdateListingDto', 'title', { maxLength: 120 }],
      ['UpdateListingDto', 'priceCents', { maximum: 1_000_000_000 }],
      ['VehicleDto', 'brand', { maxLength: 100 }],
      ['VehicleDto', 'mileageKm', { minimum: 0, maximum: 2_000_000 }],
      ['VehicleDto', 'year', { minimum: 1950, maximum: new Date().getFullYear() + 1 }],
      ['CreateInspectorProfileDto', 'bio', { maxLength: 2000 }],
      ['CreateInspectorProfileDto', 'basePriceCents', { minimum: 0, maximum: 500_000 }],
      ['UpdateInspectorProfileDto', 'bio', { maxLength: 2000 }],
      ['UpdateInspectorProfileDto', 'basePriceCents', { maximum: 500_000 }],
      ['RegisterDto', 'email', { maxLength: 254 }],
      ['RegisterDto', 'password', { minLength: 8, maxLength: 72 }],
      ['LoginDto', 'email', { maxLength: 254 }],
    ] as const)('%s.%s tem %o', (schema, field, expected) => {
      expect(prop(schema, field)).toMatchObject(expected);
    });

    it.each([
      ['page', { maximum: 200 }],
      ['limit', { maximum: 50 }],
      ['minPriceCents', { maximum: 1_000_000_000 }],
      ['maxPriceCents', { maximum: 1_000_000_000 }],
      ['brand', { maxLength: 100 }],
      ['city', { maxLength: 100 }],
      ['minYear', { minimum: 1950 }],
    ] as const)('o parâmetro %s de GET /listings tem %o', (name, expected) => {
      const param = doc.paths['/listings'].get.parameters?.find((p) => p.name === name && p.in === 'query');

      expect(param?.schema).toMatchObject(expected);
    });
  });
});
