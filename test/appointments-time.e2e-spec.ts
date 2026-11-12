import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { CLOCK } from '../src/common/clock/clock.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { FakeClock } from './support/fake-clock.js';
import {
  hoursFromNow,
  listingPayload,
  registerAndLogin,
  verifiedInspector,
} from './support/fixtures.js';
import type { TestInspector, TestUser } from './support/fixtures.js';
import { closeTestApp, createTestApp, resetDatabase } from './support/test-app.js';

/**
 * Prazos do agendamento com o relógio da aplicação controlado (FakeClock no
 * lugar do CLOCK). Os horários são calculados a partir de clock.now(), não do
 * relógio real; o JWT continua usando a hora real, o que não interfere.
 */
describe('Appointments: prazos (e2e com FakeClock)', () => {
  const START = '2030-01-01T12:00:00.000Z';
  const ADDRESS = 'Rua das Flores, 123, Boituva/SP';
  const EXPIRED_MESSAGE = 'O prazo para esta ação expirou';

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FakeClock;
  let seller: TestUser;
  let buyer: TestUser;
  let inspector: TestInspector;
  let listingId: string;

  beforeAll(async () => {
    clock = new FakeClock(START);
    app = await createTestApp({ configure: (b) => b.overrideProvider(CLOCK).useValue(clock) });
    prisma = app.get(PrismaService);
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

  function requestAs(user: TestUser, startsAt: string) {
    return request(app.getHttpServer())
      .post('/appointments')
      .set(auth(user))
      .send({ listingId, inspectorProfileId: inspector.profileId, startsAt });
  }

  function act(user: TestUser, id: string, action: string, body: object = {}) {
    return request(app.getHttpServer()).post(`/appointments/${id}/${action}`).set(auth(user)).send(body);
  }

  /** Pedido para daqui a 72h (longe do início, para o prazo ser a janela de 24h). */
  async function requested(user: TestUser = buyer): Promise<string> {
    const res = await requestAs(user, hoursFromNow(72, clock.now())).expect(201);
    return res.body.id;
  }

  async function expectExpiredBySystem(id: string): Promise<void> {
    const saved = await prisma.appointment.findUniqueOrThrow({ where: { id } });
    expect(saved).toMatchObject({ status: 'EXPIRED', endedBy: 'SYSTEM' });
    expect(saved.endedAt?.toISOString()).toBe(clock.now().toISOString());
  }

  it('accept 24h01 depois do pedido responde 409 "prazo expirou" e grava EXPIRED (endedBy SYSTEM)', async () => {
    const id = await requested();
    clock.advanceMinutes(24 * 60 + 1);

    const res = await act(inspector, id, 'accept').expect(409);

    expect(res.body.message).toBe(EXPIRED_MESSAGE);
    await expectExpiredBySystem(id);
  });

  it('confirm 24h01 depois do aceite responde 409 e grava EXPIRED', async () => {
    const id = await requested();
    clock.advanceHours(1);
    await act(inspector, id, 'accept').expect(200);
    clock.advanceMinutes(24 * 60 + 1);

    const res = await act(seller, id, 'confirm', { meetingAddress: ADDRESS }).expect(409);

    expect(res.body.message).toBe(EXPIRED_MESSAGE);
    await expectExpiredBySystem(id);
  });

  it('cancel 31 min depois da confirmação responde 409 e grava EXPIRED', async () => {
    const id = await requested();
    await act(inspector, id, 'accept').expect(200);
    await act(seller, id, 'confirm', { meetingAddress: ADDRESS }).expect(200);
    clock.advanceMinutes(31);

    const res = await act(buyer, id, 'cancel').expect(409);

    expect(res.body.message).toBe(EXPIRED_MESSAGE);
    await expectExpiredBySystem(id);
  });

  it('accept 23h59 depois do pedido ainda é aceito', async () => {
    const id = await requested();
    clock.advanceMinutes(24 * 60 - 1);

    const res = await act(inspector, id, 'accept').expect(200);

    expect(res.body.status).toBe('ACCEPTED');
  });

  it('um ACCEPTED vencido do mesmo avaliador não impede outro aceite no mesmo horário (o accept o expira)', async () => {
    const startsAt = hoursFromNow(72, clock.now());
    const first = await requestAs(buyer, startsAt).expect(201);
    await act(inspector, first.body.id, 'accept').expect(200);
    clock.advanceMinutes(24 * 60 + 1);
    const other = await registerAndLogin(app, 'outro@x.com', 'Otto Comprador');
    const second = await requestAs(other, startsAt).expect(201);

    const res = await act(inspector, second.body.id, 'accept').expect(200);

    expect(res.body.status).toBe('ACCEPTED');
    await expectExpiredBySystem(first.body.id);
    expect(await prisma.appointment.count({ where: { status: 'ACCEPTED' } })).toBe(1);
  });
});
