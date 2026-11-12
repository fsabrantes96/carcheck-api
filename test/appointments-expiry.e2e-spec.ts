import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppointmentExpiryCron } from '../src/appointments/appointment-expiry.cron.js';
import { AppointmentExpiryService } from '../src/appointments/appointment-expiry.service.js';
import { CLOCK } from '../src/common/clock/clock.js';
import { isPgError, PG_EXCLUSION_VIOLATION } from '../src/common/prisma/prisma-errors.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeClock } from './support/fake-clock.js';
import {
  ERROR_KEYS,
  hoursFromNow,
  listingPayload,
  registerAndLogin,
  verifiedInspector,
} from './support/fixtures.js';
import type { TestInspector, TestUser } from './support/fixtures.js';
import { closeTestApp, createTestApp, resetDatabase } from './support/test-app.js';

/**
 * Job de expiração (PR C) contra o Postgres real. O cron não roda nos e2e
 * (JOBS_ENABLED=false no vitest.config.e2e.ts): os testes chamam
 * expireDue direto, com a hora do FakeClock.
 */
describe('Appointments: job de expiração (e2e com FakeClock)', () => {
  const START = '2030-01-01T12:00:00.000Z';
  const ADDRESS = 'Rua das Flores, 123, Boituva/SP';
  /** Passa todos os prazos criados em START (24h, 24h e 30min). */
  const AFTER_ALL_DEADLINES_MINUTES = 24 * 60 + 1;

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let expiry: AppointmentExpiryService;
  let clock: FakeClock;
  let seller: TestUser;
  let buyer: TestUser;
  let inspector: TestInspector;
  let listingId: string;

  beforeAll(async () => {
    clock = new FakeClock(START);
    app = await createTestApp({ configure: (b) => b.overrideProvider(CLOCK).useValue(clock) });
    prisma = app.get(PrismaService);
    expiry = app.get(AppointmentExpiryService);
  });

  beforeEach(async () => {
    clock.set(START);
    await resetDatabase(app);
    seller = await registerAndLogin(app, 'vendedor@x.com', 'Vera Vendedora');
    buyer = await registerAndLogin(app, 'comprador@x.com', 'Bruno Comprador');
    inspector = await verifiedInspector(app, 'avaliador@x.com', 'Ivo Avaliador');
    const listing = await request(app.getHttpServer())
      .post('/listings')
      .set(auth(seller))
      .send(listingPayload())
      .expect(201);
    listingId = listing.body.id;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  function auth(user: TestUser) {
    return { Authorization: `Bearer ${user.token}` };
  }

  function act(user: TestUser, id: string, action: string, body: object = {}) {
    return request(app.getHttpServer()).post(`/appointments/${id}/${action}`).set(auth(user)).send(body);
  }

  type OpenState = 'REQUESTED' | 'ACCEPTED' | 'AWAITING_PAYMENT';

  /**
   * Agendamento no estado pedido, criado pelas rotas. `hoursAhead` separa os
   * horários (a exclusion constraint barra ACCEPTED sobrepostos); cada
   * chamada usa um comprador novo, por causa do índice do trio em aberto.
   */
  async function appointmentIn(state: OpenState, hoursAhead = 72): Promise<{ id: string; buyer: TestUser }> {
    const owner =
      state === 'REQUESTED' && hoursAhead === 72
        ? buyer
        : await registerAndLogin(app, `comprador-${state.toLowerCase()}-${hoursAhead}@x.com`, 'Outro Comprador');
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .set(auth(owner))
      .send({ listingId, inspectorProfileId: inspector.profileId, startsAt: hoursFromNow(hoursAhead, clock.now()) })
      .expect(201);
    const id: string = res.body.id;
    if (state !== 'REQUESTED') await act(inspector, id, 'accept').expect(200);
    if (state === 'AWAITING_PAYMENT') await act(seller, id, 'confirm', { meetingAddress: ADDRESS }).expect(200);
    return { id, buyer: owner };
  }

  function load(id: string) {
    return prisma.appointment.findUniqueOrThrow({ where: { id } });
  }

  describe('expireDue', () => {
    it.each(['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] as const)(
      '%s vencido passa para EXPIRED com endedBy SYSTEM e endedAt = agora',
      async (state) => {
        const { id } = await appointmentIn(state);
        clock.advanceMinutes(AFTER_ALL_DEADLINES_MINUTES);

        const count = await expiry.expireDue(clock.now());

        expect(count).toBe(1);
        const saved = await load(id);
        expect(saved).toMatchObject({ status: 'EXPIRED', endedBy: 'SYSTEM' });
        expect(saved.endedAt?.toISOString()).toBe(clock.now().toISOString());
      },
    );

    it('não muda agendamentos com prazo no futuro', async () => {
      const requested = await appointmentIn('REQUESTED', 72);
      const accepted = await appointmentIn('ACCEPTED', 96);
      const awaiting = await appointmentIn('AWAITING_PAYMENT', 120);
      clock.advanceMinutes(29); // o prazo mais curto (pagamento) é de 30 min

      const count = await expiry.expireDue(clock.now());

      expect(count).toBe(0);
      expect((await load(requested.id)).status).toBe('REQUESTED');
      expect((await load(accepted.id)).status).toBe('ACCEPTED');
      expect((await load(awaiting.id)).status).toBe('AWAITING_PAYMENT');
    });

    it('não muda PAID, mesmo com expiresAt no passado', async () => {
      const { id } = await appointmentIn('AWAITING_PAYMENT');
      // Sem rota de pagamento: avança direto no banco, mantendo o expiresAt herdado (risco 47).
      await prisma.appointment.update({ where: { id }, data: { status: 'PAID' } });
      clock.advanceMinutes(AFTER_ALL_DEADLINES_MINUTES);

      const count = await expiry.expireDue(clock.now());

      expect(count).toBe(0);
      expect(await load(id)).toMatchObject({ status: 'PAID', endedBy: null, endedAt: null });
    });

    it('não muda agendamentos já encerrados (cancelado, recusado, expirado)', async () => {
      const cancelled = await appointmentIn('ACCEPTED', 96);
      await act(cancelled.buyer, cancelled.id, 'cancel').expect(200);
      const declined = await appointmentIn('REQUESTED', 72);
      await act(inspector, declined.id, 'decline').expect(200);
      const expired = await appointmentIn('AWAITING_PAYMENT', 120);
      clock.advanceMinutes(31);
      await expiry.expireDue(clock.now());
      const before = await Promise.all([cancelled.id, declined.id, expired.id].map(load));
      clock.advanceMinutes(AFTER_ALL_DEADLINES_MINUTES);

      const count = await expiry.expireDue(clock.now());

      expect(count).toBe(0);
      const after = await Promise.all([cancelled.id, declined.id, expired.id].map(load));
      expect(after.map((a) => [a.status, a.endedBy, a.endedAt?.toISOString()])).toEqual([
        ['CANCELLED', 'BUYER', before[0].endedAt?.toISOString()],
        ['DECLINED', 'INSPECTOR', before[1].endedAt?.toISOString()],
        ['EXPIRED', 'SYSTEM', before[2].endedAt?.toISOString()],
      ]);
    });

    it('rodar duas vezes seguidas: a segunda devolve 0 e não altera o encerramento', async () => {
      const { id } = await appointmentIn('ACCEPTED');
      clock.advanceMinutes(AFTER_ALL_DEADLINES_MINUTES);
      const firstRun = clock.now();

      expect(await expiry.expireDue(firstRun)).toBe(1);
      clock.advanceMinutes(1);
      expect(await expiry.expireDue(clock.now())).toBe(0);

      expect((await load(id)).endedAt?.toISOString()).toBe(firstRun.toISOString());
    });
  });

  describe('horário liberado', () => {
    it.each(['ACCEPTED', 'AWAITING_PAYMENT'] as const)(
      'um %s vencido bloqueia o horário até o job; depois dele, o mesmo horário com o mesmo avaliador é aceito pela constraint',
      async (state) => {
        const { id } = await appointmentIn(state);
        const original = await load(id);
        const other = await registerAndLogin(app, 'concorrente@x.com', 'Carla Concorrente');
        clock.advanceMinutes(AFTER_ALL_DEADLINES_MINUTES);
        // Insere direto no banco, sem passar pelo accept (que limparia os
        // vencidos sozinho): só a exclusion constraint decide.
        const insertSameSlot = () =>
          prisma.appointment.create({
            data: {
              listingId: original.listingId,
              buyerId: other.id,
              sellerId: original.sellerId,
              inspectorUserId: original.inspectorUserId,
              status: 'ACCEPTED',
              startsAt: original.startsAt,
              endsAt: original.endsAt,
              expiresAt: original.startsAt,
              acceptedAt: clock.now(),
              priceCents: original.priceCents,
              platformFeeBps: original.platformFeeBps,
              platformFeeCents: original.platformFeeCents,
              inspectorPayoutCents: original.inspectorPayoutCents,
            },
          });

        const blocked: unknown = await insertSameSlot().then(
          () => null,
          (error: unknown) => error,
        );
        expect(isPgError(blocked, PG_EXCLUSION_VIOLATION)).toBe(true);

        expect(await expiry.expireDue(clock.now())).toBe(1);

        const created = await insertSameSlot();
        expect(created.status).toBe('ACCEPTED');
        expect((await load(id)).status).toBe('EXPIRED');
      },
    );
  });

  describe('depois de expirado pelo job', () => {
    it.each([
      ['accept', 'REQUESTED', 'inspector'],
      ['decline', 'REQUESTED', 'inspector'],
      ['confirm', 'ACCEPTED', 'seller'],
      ['cancel', 'AWAITING_PAYMENT', 'buyer'],
    ] as const)(
      '%s (em agendamento que era %s) responde 409 "Ação não permitida no estado atual" no formato global',
      async (action, state, who) => {
        const appointment = await appointmentIn(state);
        clock.advanceMinutes(AFTER_ALL_DEADLINES_MINUTES);
        await expiry.expireDue(clock.now());
        const actor = { inspector, seller, buyer: appointment.buyer }[who];

        const res = await act(actor, appointment.id, action, action === 'confirm' ? { meetingAddress: ADDRESS } : {});

        expect(res.status).toBe(409);
        expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
        expect(res.body).toMatchObject({ statusCode: 409, message: 'Ação não permitida no estado atual' });
        expect((await load(appointment.id)).status).toBe('EXPIRED');
      },
    );

    it.each([
      ['buyer', 'BUYER'],
      ['seller', 'SELLER'],
      ['inspector', 'INSPECTOR'],
    ] as const)('o detalhe mostra EXPIRED para o %s, sem ações disponíveis', async (who, role) => {
      const { id } = await appointmentIn('REQUESTED');
      clock.advanceMinutes(AFTER_ALL_DEADLINES_MINUTES);
      await expiry.expireDue(clock.now());
      const actor = { buyer, seller, inspector }[who];

      const res = await request(app.getHttpServer()).get(`/appointments/${id}`).set(auth(actor)).expect(200);

      expect(res.body).toMatchObject({ myRole: role, status: 'EXPIRED', endedBy: 'SYSTEM', availableActions: [] });
    });

    it('a listagem filtrada por EXPIRED traz o agendamento expirado pelo job', async () => {
      const { id } = await appointmentIn('REQUESTED');
      clock.advanceMinutes(AFTER_ALL_DEADLINES_MINUTES);
      await expiry.expireDue(clock.now());

      const res = await request(app.getHttpServer())
        .get('/appointments?status=EXPIRED')
        .set(auth(buyer))
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({ id, status: 'EXPIRED', endedBy: 'SYSTEM', myRole: 'BUYER' });
    });

    it.each(['BuyerAppointmentResponseDto', 'SellerAppointmentResponseDto', 'InspectorAppointmentResponseDto'])(
      'o schema %s no OpenAPI admite status EXPIRED e endedBy SYSTEM',
      async (name) => {
        const res = await request(app.getHttpServer()).get('/docs-json').expect(200);

        const { properties } = res.body.components.schemas[name];
        expect(properties.status.enum).toContain('EXPIRED');
        expect(properties.endedBy.enum).toContain('SYSTEM');
      },
    );
  });

  describe('com JOBS_ENABLED=false (configuração dos e2e)', () => {
    it('a app não tem a classe do cron, mas tem o AppointmentExpiryService', () => {
      expect(() => app.get(AppointmentExpiryCron, { strict: false })).toThrow();
      expect(app.get(AppointmentExpiryService, { strict: false })).toBeInstanceOf(AppointmentExpiryService);
    });
  });
});
