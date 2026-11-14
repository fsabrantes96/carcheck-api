import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  ERROR_KEYS,
  hoursFromNow,
  inspectorProfilePayload,
  listingPayload,
  registerAndLogin,
  verifiedInspector,
} from './support/fixtures.js';
import type { TestInspector, TestUser } from './support/fixtures.js';
import { closeTestApp, createTestApp, resetDatabase } from './support/test-app.js';

/**
 * Codes de domínio (ErrorCode) que o front precisa distinguir: um caso por
 * code, conferindo status, code, mensagem e o formato global. STATE_CHANGED
 * (corrida entre a leitura e a gravação) fica nos unitários dos services.
 */
describe('Codes de domínio (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let seller: TestUser;
  let buyer: TestUser;
  let inspector: TestInspector;
  const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

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

  const server = () => request(app.getHttpServer());
  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

  function expectCoded(res: request.Response, statusCode: number, code: string, message?: string) {
    expect(res.status).toBe(statusCode);
    expect(res.body.code).toBe(code);
    if (message !== undefined) expect(res.body.message).toBe(message);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
  }

  async function createListing(owner: TestUser = seller): Promise<string> {
    const res = await server().post('/listings').set(auth(owner)).send(listingPayload()).expect(201);
    return res.body.id as string;
  }

  function requestAppointment(
    listingId: string,
    who: TestUser = buyer,
    startsAt = hoursFromNow(48),
    inspectorProfileId = inspector.profileId,
  ) {
    return server()
      .post('/appointments')
      .set(auth(who))
      .send({ listingId, inspectorProfileId, startsAt });
  }

  const act = (user: TestUser, id: string, action: string) =>
    server().post(`/appointments/${id}/${action}`).set(auth(user));

  describe('auth', () => {
    it('INVALID_CREDENTIALS: senha errada', async () => {
      const res = await server()
        .post('/auth/login')
        .send({ email: buyer.email, password: 'senha-errada-123' });

      expectCoded(res, 401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos');
    });

    it('EMAIL_ALREADY_REGISTERED: cadastro repetido', async () => {
      const res = await server()
        .post('/auth/register')
        .send({ name: 'Outro', email: buyer.email, password: 'senha12345' });

      expectCoded(res, 409, 'EMAIL_ALREADY_REGISTERED', 'E-mail já cadastrado');
    });

    it('USER_NOT_FOUND: /auth/me com token válido de uma conta que não existe mais', async () => {
      const token = app.get(JwtService).sign({ sub: UNKNOWN_ID, email: 'fantasma@x.com' });

      const res = await server().get('/auth/me').set('Authorization', `Bearer ${token}`);

      expectCoded(res, 404, 'USER_NOT_FOUND', 'Usuário não encontrado');
    });
  });

  describe('anúncios', () => {
    it('LISTING_NOT_FOUND: anúncio inexistente', async () => {
      const res = await server().get(`/listings/${UNKNOWN_ID}`);

      expectCoded(res, 404, 'LISTING_NOT_FOUND', 'Anúncio não encontrado');
    });

    it('INVALID_STATE: transição não permitida no status atual', async () => {
      const listingId = await createListing();

      const res = await server().post(`/listings/${listingId}/activate`).set(auth(seller));

      expectCoded(res, 409, 'INVALID_STATE', 'Ação não permitida no status atual do anúncio');
    });

    it('INVALID_STATE: PATCH em anúncio arquivado', async () => {
      const listingId = await createListing();
      await server().delete(`/listings/${listingId}`).set(auth(seller)).expect(204);

      const res = await server()
        .patch(`/listings/${listingId}`)
        .set(auth(seller))
        .send({ title: 'Novo título do anúncio' });

      expectCoded(res, 409, 'INVALID_STATE', 'Anúncio arquivado não pode ser alterado');
    });

    it('LISTING_HAS_PAID_APPOINTMENT: pausar com avaliação paga', async () => {
      const listingId = await createListing();
      const created = await requestAppointment(listingId).expect(201);
      await prisma.appointment.update({
        where: { id: created.body.id },
        data: { status: 'PAID', meetingAddress: 'Rua A, 10', expiresAt: null },
      });

      const res = await server().post(`/listings/${listingId}/pause`).set(auth(seller));

      expectCoded(res, 409, 'LISTING_HAS_PAID_APPOINTMENT');
    });

    it('FORBIDDEN: transição no anúncio de outro usuário', async () => {
      const listingId = await createListing();

      const res = await server().post(`/listings/${listingId}/pause`).set(auth(buyer));

      expectCoded(res, 403, 'FORBIDDEN', 'Este anúncio não pertence a você');
    });
  });

  describe('avaliadores', () => {
    it('INSPECTOR_PROFILE_EXISTS: segundo perfil', async () => {
      const res = await server()
        .post('/inspectors/me')
        .set(auth(inspector))
        .send(inspectorProfilePayload);

      expectCoded(res, 409, 'INSPECTOR_PROFILE_EXISTS', 'Você já possui perfil de avaliador');
    });

    it('INSPECTOR_PROFILE_NOT_FOUND: role INSPECTOR sem perfil', async () => {
      await prisma.user.update({ where: { id: buyer.id }, data: { roles: ['USER', 'INSPECTOR'] } });

      const res = await server().get('/inspectors/me').set(auth(buyer));

      expectCoded(res, 404, 'INSPECTOR_PROFILE_NOT_FOUND', 'Perfil de avaliador não encontrado');
    });

    it('PRICE_BELOW_MINIMUM: preço base abaixo do mínimo da plataforma', async () => {
      const res = await server()
        .post('/inspectors/me')
        .set(auth(buyer))
        .send({ ...inspectorProfilePayload, basePriceCents: 100 });

      expectCoded(res, 400, 'PRICE_BELOW_MINIMUM');
      expect(res.body.message).toMatch(/^O preço base precisa ser de pelo menos/);
    });
  });

  describe('agendamentos', () => {
    it('INSPECTOR_NOT_FOUND: avaliador inexistente', async () => {
      const listingId = await createListing();

      const res = await requestAppointment(listingId, buyer, hoursFromNow(48), UNKNOWN_ID);

      expectCoded(res, 404, 'INSPECTOR_NOT_FOUND', 'Avaliador não encontrado');
    });

    it('LISTING_NOT_FOUND: agendar em anúncio que não está ativo', async () => {
      const listingId = await createListing();
      await server().post(`/listings/${listingId}/pause`).set(auth(seller)).expect(200);

      const res = await requestAppointment(listingId);

      expectCoded(res, 404, 'LISTING_NOT_FOUND', 'Anúncio não encontrado');
    });

    it('APPOINTMENT_NOT_FOUND: agendamento inexistente', async () => {
      const res = await server().get(`/appointments/${UNKNOWN_ID}`).set(auth(buyer));

      expectCoded(res, 404, 'APPOINTMENT_NOT_FOUND', 'Agendamento não encontrado');
    });

    it('INVALID_SCHEDULE: horário sem a antecedência mínima', async () => {
      const listingId = await createListing();

      const res = await requestAppointment(listingId, buyer, hoursFromNow(1));

      expectCoded(res, 400, 'INVALID_SCHEDULE');
    });

    it('INSPECTOR_UNAVAILABLE: avaliador é o vendedor do anúncio', async () => {
      const listingId = await createListing(inspector);

      const res = await requestAppointment(listingId);

      expectCoded(res, 409, 'INSPECTOR_UNAVAILABLE', 'Este avaliador não está disponível para este anúncio');
    });

    it('APPOINTMENT_DUPLICATE: segundo pedido em aberto para o mesmo anúncio e avaliador', async () => {
      const listingId = await createListing();
      await requestAppointment(listingId).expect(201);

      const res = await requestAppointment(listingId, buyer, hoursFromNow(72));

      expectCoded(res, 409, 'APPOINTMENT_DUPLICATE');
    });

    it('SLOT_UNAVAILABLE: horário do avaliador já ocupado (checagem na criação)', async () => {
      const listingId = await createListing();
      const first = await requestAppointment(listingId).expect(201);
      await act(inspector, first.body.id, 'accept').expect(200);
      const otherBuyer = await registerAndLogin(app, 'outro@x.com', 'Olga');

      const res = await requestAppointment(listingId, otherBuyer);

      expectCoded(res, 409, 'SLOT_UNAVAILABLE', 'O avaliador não está disponível nesse horário');
    });

    it('SLOT_UNAVAILABLE: reserva dupla barrada no aceite', async () => {
      const listingId = await createListing();
      const otherBuyer = await registerAndLogin(app, 'outro@x.com', 'Olga');
      const first = await requestAppointment(listingId).expect(201);
      const second = await requestAppointment(listingId, otherBuyer).expect(201);
      await act(inspector, first.body.id, 'accept').expect(200);

      const res = await act(inspector, second.body.id, 'accept');

      expectCoded(res, 409, 'SLOT_UNAVAILABLE');
    });

    it('INSPECTOR_NOT_VERIFIED: aceitar com o perfil não verificado', async () => {
      const listingId = await createListing();
      const created = await requestAppointment(listingId).expect(201);
      await prisma.inspectorProfile.update({
        where: { id: inspector.profileId },
        data: { verified: false },
      });

      const res = await act(inspector, created.body.id, 'accept');

      expectCoded(res, 409, 'INSPECTOR_NOT_VERIFIED', 'Seu perfil de avaliador precisa estar verificado para aceitar');
    });

    describe('os dois 409 de ação têm codes diferentes', () => {
      it('INVALID_STATE: "Ação não permitida no estado atual"', async () => {
        const listingId = await createListing();
        const created = await requestAppointment(listingId).expect(201);
        await act(buyer, created.body.id, 'cancel').expect(200);

        const res = await act(buyer, created.body.id, 'cancel');

        expectCoded(res, 409, 'INVALID_STATE', 'Ação não permitida no estado atual');
      });

      it('APPOINTMENT_EXPIRED: "O prazo para esta ação expirou"', async () => {
        const listingId = await createListing();
        const created = await requestAppointment(listingId).expect(201);
        await prisma.appointment.update({
          where: { id: created.body.id },
          data: { expiresAt: new Date(Date.now() - 60_000) },
        });

        const res = await act(inspector, created.body.id, 'accept');

        expectCoded(res, 409, 'APPOINTMENT_EXPIRED', 'O prazo para esta ação expirou');
      });
    });

    it('FORBIDDEN: participante cujo papel não pode agir', async () => {
      const listingId = await createListing();
      const created = await requestAppointment(listingId).expect(201);

      const res = await act(buyer, created.body.id, 'accept');

      expectCoded(res, 403, 'FORBIDDEN', 'Você não pode aceitar este agendamento');
    });
  });
});
