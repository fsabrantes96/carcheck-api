import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  hoursFromNow,
  listingPayload,
  registerAndLogin,
  verifiedInspector,
} from './support/fixtures.js';
import type { TestInspector, TestUser } from './support/fixtures.js';
import { closeTestApp, createTestApp, resetDatabase } from './support/test-app.js';

describe('Appointments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let seller: TestUser;
  let buyer: TestUser;
  let inspector: TestInspector;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
    seller = await registerAndLogin(app, 'vendedor@x.com', 'Vera Vendedora');
    buyer = await registerAndLogin(app, 'comprador@x.com', 'Bruno Comprador');
    inspector = await verifiedInspector(app, 'avaliador@x.com', 'Ivo Avaliador');
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

  async function createListing(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/listings')
      .set(auth(seller))
      .send(listingPayload())
      .expect(201);
    return (res.body as { id: string }).id;
  }

  function requestAppointment(listingId: string, startsAt = hoursFromNow(48)) {
    return request(app.getHttpServer())
      .post('/appointments')
      .set(auth(buyer))
      .send({ listingId, inspectorProfileId: inspector.profileId, startsAt });
  }

  describe('anúncio saindo de ACTIVE', () => {
    it.each(['pause', 'mark-sold'])(
      '%s cancela os agendamentos em aberto do anúncio (CANCELLED, endedBy SYSTEM)',
      async (route) => {
        const listingId = await createListing();
        const created = await requestAppointment(listingId).expect(201);

        await request(app.getHttpServer())
          .post(`/listings/${listingId}/${route}`)
          .set(auth(seller))
          .expect(200);

        const saved = await prisma.appointment.findUniqueOrThrow({ where: { id: created.body.id } });
        expect(saved).toMatchObject({ status: 'CANCELLED', endedBy: 'SYSTEM' });
        expect(saved.endedAt).toBeInstanceOf(Date);
      },
    );

    it('DELETE (arquivar) também cancela os agendamentos em aberto', async () => {
      const listingId = await createListing();
      const created = await requestAppointment(listingId).expect(201);

      await request(app.getHttpServer()).delete(`/listings/${listingId}`).set(auth(seller)).expect(204);

      const saved = await prisma.appointment.findUniqueOrThrow({ where: { id: created.body.id } });
      expect(saved.status).toBe('CANCELLED');
    });

    it('responde 409 e não muda nada quando há agendamento PAID', async () => {
      const listingId = await createListing();
      const created = await requestAppointment(listingId).expect(201);
      // PAID não tem rota nesta branch: o estado é posto direto no banco.
      await prisma.appointment.update({
        where: { id: created.body.id },
        data: { status: 'PAID', meetingAddress: 'Rua A, 10', expiresAt: null },
      });

      const res = await request(app.getHttpServer())
        .post(`/listings/${listingId}/pause`)
        .set(auth(seller))
        .expect(409);

      expect(res.body.message).toBe('O anúncio tem avaliação paga em andamento e não pode sair de ACTIVE');
      expect((await prisma.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe('ACTIVE');
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('PAID');
    });

    it('criação e pausa simultâneas: nunca 500 e nunca sobra agendamento aberto em anúncio pausado', async () => {
      const rounds = 8;
      for (let round = 0; round < rounds; round++) {
        await prisma.appointment.deleteMany();
        const listingId = await createListing();

        const [created, paused] = await Promise.all([
          requestAppointment(listingId),
          request(app.getHttpServer()).post(`/listings/${listingId}/pause`).set(auth(seller)),
        ]);

        expect([201, 404]).toContain(created.status);
        expect(paused.status).toBe(200);
        const open = await prisma.appointment.count({
          where: { listingId, status: { in: ['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] } },
        });
        expect(open, `rodada ${round}: agendamento aberto em anúncio pausado`).toBe(0);
        if (created.status === 201) {
          const saved = await prisma.appointment.findUniqueOrThrow({ where: { id: created.body.id } });
          expect(saved).toMatchObject({ status: 'CANCELLED', endedBy: 'SYSTEM' });
        }
      }
    });
  });
});
