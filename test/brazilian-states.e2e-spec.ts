import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  inspectorProfilePayload,
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

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const INVALID = ['XX', '12', 'S️P️'];

/** O 400 de validação com o erro de state (mensagem padrão do @IsIn). */
function expectStateError(res: request.Response) {
  expect(res.body.message).toBe('Dados inválidos');
  expect(Object.keys(res.body).sort()).toEqual(VALIDATION_ERROR_KEYS);
  expect(res.body.errors).toHaveLength(1);
  expect(res.body.errors[0]).toMatch(
    /^state must be one of the following values: AC, AL, /,
  );
}

describe('UF em state (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    user = await registerAndLogin(app, 'pessoa@x.com', 'Pessoa');
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  const server = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${user.token}` });

  async function createListing(state = 'SP'): Promise<string> {
    const res = await request(server())
      .post('/listings')
      .set(auth())
      .send(listingPayload({ state }))
      .expect(201);
    return (res.body as { id: string }).id;
  }

  describe('anúncio', () => {
    it.each(INVALID)('POST /listings com state %o responde 400 e não cria', async (state) => {
      const res = await request(server())
        .post('/listings')
        .set(auth())
        .send(listingPayload({ state }))
        .expect(400);

      expectStateError(res);
      expect(await prisma.listing.count()).toBe(0);
    });

    it('POST /listings com UF válida em minúsculas responde 201 e grava em maiúsculas', async () => {
      const res = await request(server())
        .post('/listings')
        .set(auth())
        .send(listingPayload({ state: ' rj ' }))
        .expect(201);

      expect(res.body.state).toBe('RJ');
      const saved = await prisma.listing.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(saved.state).toBe('RJ');
    });

    it('PATCH /listings/:id com state inválido responde 400 e não altera', async () => {
      const id = await createListing('SP');

      const res = await request(server())
        .patch(`/listings/${id}`)
        .set(auth())
        .send({ state: 'XX' })
        .expect(400);

      expectStateError(res);
      expect((await prisma.listing.findUniqueOrThrow({ where: { id } })).state).toBe('SP');
    });

    it('PATCH /listings/:id com UF válida responde 200', async () => {
      const id = await createListing('SP');

      const res = await request(server())
        .patch(`/listings/${id}`)
        .set(auth())
        .send({ state: 'mg' })
        .expect(200);

      expect(res.body.state).toBe('MG');
    });
  });

  describe('perfil do avaliador', () => {
    it.each(INVALID)('POST /inspectors/me com state %o responde 400 e não cria', async (state) => {
      const res = await request(server())
        .post('/inspectors/me')
        .set(auth())
        .send({ ...inspectorProfilePayload, state })
        .expect(400);

      expectStateError(res);
      expect(await prisma.inspectorProfile.count()).toBe(0);
    });

    it('POST /inspectors/me com UF válida em minúsculas grava em maiúsculas', async () => {
      const res = await request(server())
        .post('/inspectors/me')
        .set(auth())
        .send({ ...inspectorProfilePayload, state: 'ba' })
        .expect(201);

      expect(res.body.state).toBe('BA');
    });

    it('PATCH /inspectors/me com state inválido responde 400 e com UF válida responde 200', async () => {
      await request(server())
        .post('/inspectors/me')
        .set(auth())
        .send(inspectorProfilePayload)
        .expect(201);

      const invalid = await request(server())
        .patch('/inspectors/me')
        .set(auth())
        .send({ state: '12' })
        .expect(400);
      expectStateError(invalid);

      const valid = await request(server())
        .patch('/inspectors/me')
        .set(auth())
        .send({ state: 'PR' })
        .expect(200);
      expect(valid.body.state).toBe('PR');
    });
  });

  describe('filtro de GET /listings', () => {
    it.each(INVALID)('state=%o responde 400', async (state) => {
      const res = await request(server()).get('/listings').query({ state }).expect(400);

      expectStateError(res);
    });

    it('state=rj filtra pela UF, sem diferenciar maiúsculas', async () => {
      const rj = await createListing('RJ');
      await createListing('SP');

      const res = await request(server()).get('/listings').query({ state: 'rj' }).expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items.map((l: { id: string }) => l.id)).toEqual([rj]);
    });
  });

  describe('contrato no /docs-json', () => {
    type Doc = {
      components: { schemas: Record<string, { enum?: string[]; properties?: Record<string, unknown> }> };
      paths: Record<string, Record<string, { parameters?: { name: string; schema: unknown }[] }>>;
    };
    let doc: Doc;
    const REF = '#/components/schemas/BrazilianState';

    beforeEach(async () => {
      doc = (await request(server()).get('/docs-json').expect(200)).body as Doc;
    });

    it('o schema BrazilianState é um enum com as 27 UFs', () => {
      expect(doc.components.schemas.BrazilianState).toMatchObject({ type: 'string' });
      expect(doc.components.schemas.BrazilianState.enum).toEqual(UFS);
    });

    it.each([
      'CreateListingDto',
      'UpdateListingDto',
      'CreateInspectorProfileDto',
      'UpdateInspectorProfileDto',
      'ListingResponseDto',
      'MyListingResponseDto',
      'InspectorResponseDto',
      'MyInspectorProfileResponseDto',
      'AppointmentListingDto',
    ])('%s.state usa o BrazilianState', (schema) => {
      const state = doc.components.schemas[schema].properties?.state;

      expect(JSON.stringify(state)).toContain(REF);
    });

    it('o filtro state de GET /listings usa o BrazilianState', () => {
      const param = doc.paths['/listings'].get.parameters?.find((p) => p.name === 'state');

      expect(JSON.stringify(param?.schema)).toContain(REF);
    });
  });
});
