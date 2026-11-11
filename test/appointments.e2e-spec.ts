import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { APPOINTMENT_OPEN_TRIPLET_INDEX } from '../src/appointments/appointments.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  ERROR_KEYS,
  hoursFromNow,
  inspectorProfilePayload,
  listingPayload,
  registerAndLogin,
  VALIDATION_ERROR_KEYS,
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

  describe('PAID com expiresAt vencido (ex.: herdado ao avançar o estado pelo prisma studio)', () => {
    async function paidWithStaleDeadline(): Promise<string> {
      const listingId = await createListing();
      const created = await requestAppointment(listingId).expect(201);
      await prisma.appointment.update({
        where: { id: created.body.id },
        data: {
          status: 'PAID',
          meetingAddress: 'Rua A, 10',
          expiresAt: new Date(Date.now() - 3_600_000),
        },
      });
      return created.body.id as string;
    }

    it('continua ocupando o horário: outro pedido no mesmo horário recebe 409', async () => {
      await paidWithStaleDeadline();
      const otherBuyer = await registerAndLogin(app, 'outro.comprador@x.com', 'Olga');
      const otherListing = await createListing();

      const res = await request(app.getHttpServer())
        .post('/appointments')
        .set(auth(otherBuyer))
        .send({
          listingId: otherListing,
          inspectorProfileId: inspector.profileId,
          startsAt: hoursFromNow(48),
        })
        .expect(409);

      expect(res.body.message).toBe('O avaliador não está disponível nesse horário');
    });

    it('não é expirado pela limpeza do aceite de outro agendamento do mesmo avaliador', async () => {
      const paidId = await paidWithStaleDeadline();
      const otherBuyer = await registerAndLogin(app, 'outro.comprador@x.com', 'Olga');
      const otherListing = await createListing();
      // Horário que não se sobrepõe: o aceite passa e roda a limpeza dos vencidos.
      const other = await request(app.getHttpServer())
        .post('/appointments')
        .set(auth(otherBuyer))
        .send({ listingId: otherListing, inspectorProfileId: inspector.profileId, startsAt: hoursFromNow(72) })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/appointments/${other.body.id}/accept`)
        .set(auth(inspector))
        .expect(200);

      const paid = await prisma.appointment.findUniqueOrThrow({ where: { id: paidId } });
      expect(paid.status).toBe('PAID');
      expect(paid.endedBy).toBeNull();
    });
  });

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

  // Helpers dos blocos abaixo.

  const ADDRESS = 'Rua das Flores, 123, Boituva/SP';
  const BASE_KEYS = [
    'availableActions',
    'buyer',
    'createdAt',
    'endedBy',
    'endsAt',
    'expiresAt',
    'id',
    'inspector',
    'listing',
    'meetingAddress',
    'myRole',
    'seller',
    'startsAt',
    'status',
  ];
  const KEYS_BY_ROLE = {
    SELLER: [...BASE_KEYS].sort(),
    BUYER: [...BASE_KEYS, 'priceCents'].sort(),
    INSPECTOR: [...BASE_KEYS, 'inspectorPayoutCents', 'platformFeeBps', 'platformFeeCents', 'priceCents'].sort(),
  };
  /** Mensagens possíveis de quem perde uma corrida de transição. */
  const RACE_MESSAGES = [
    'O agendamento mudou ou o horário não está mais disponível',
    'O agendamento mudou de estado; recarregue e tente novamente',
    'Ação não permitida no estado atual',
  ];
  const NOT_FOUND = 'Agendamento não encontrado';
  type Role = keyof typeof KEYS_BY_ROLE;
  type Action = 'accept' | 'decline' | 'confirm' | 'cancel';

  function userFor(role: Role): TestUser {
    return { BUYER: buyer, SELLER: seller, INSPECTOR: inspector }[role];
  }

  async function createListingAs(owner: TestUser): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/listings')
      .set(auth(owner))
      .send(listingPayload())
      .expect(201);
    return (res.body as { id: string }).id;
  }

  function requestAs(
    user: TestUser,
    listingId: string,
    startsAt = hoursFromNow(48),
    inspectorProfileId = inspector.profileId,
  ) {
    return request(app.getHttpServer())
      .post('/appointments')
      .set(auth(user))
      .send({ listingId, inspectorProfileId, startsAt });
  }

  function act(user: TestUser, id: string, action: Action, body: object = {}) {
    return request(app.getHttpServer())
      .post(`/appointments/${id}/${action}`)
      .set(auth(user))
      .send(body);
  }

  function getOne(user: TestUser, id: string) {
    return request(app.getHttpServer()).get(`/appointments/${id}`).set(auth(user));
  }

  async function requestedAppointment(listingId?: string): Promise<string> {
    const res = await requestAppointment(listingId ?? (await createListing())).expect(201);
    return (res.body as { id: string }).id;
  }

  async function acceptedAppointment(): Promise<string> {
    const id = await requestedAppointment();
    await act(inspector, id, 'accept').expect(200);
    return id;
  }

  async function awaitingPaymentAppointment(): Promise<string> {
    const id = await acceptedAppointment();
    await act(seller, id, 'confirm', { meetingAddress: ADDRESS }).expect(200);
    return id;
  }

  function expectNoUserIds(body: unknown): void {
    const json = JSON.stringify(body);
    expect(json).not.toContain('"buyerId"');
    expect(json).not.toContain('"sellerId"');
    expect(json).not.toContain('"inspectorUserId"');
    expect(json).not.toContain(buyer.id);
    expect(json).not.toContain(seller.id);
    expect(json).not.toContain(inspector.id);
  }

  describe('fluxo feliz até AWAITING_PAYMENT', () => {
    it('o comprador cria o pedido: 201 no formato do comprador, REQUESTED e priceCents 15000', async () => {
      const listingId = await createListing();

      const res = await requestAppointment(listingId).expect(201);

      expect(res.body).toMatchObject({
        myRole: 'BUYER',
        status: 'REQUESTED',
        priceCents: 15000,
        listing: { id: listingId, title: 'Gol 1.0 2018 completo', city: 'Boituva', state: 'SP' },
        inspector: { profileId: inspector.profileId, name: 'Ivo Avaliador' },
        buyer: { name: 'Bruno Comprador' },
        seller: { name: 'Vera Vendedora' },
        meetingAddress: null,
        endedBy: null,
        availableActions: ['CANCEL'],
      });
      expect(Object.keys(res.body).sort()).toEqual(KEYS_BY_ROLE.BUYER);
    });

    it('o avaliador aceita: 200 no formato do avaliador, com comissão 1500 e repasse 13500', async () => {
      const id = await requestedAppointment();

      const res = await act(inspector, id, 'accept').expect(200);

      expect(res.body).toMatchObject({
        myRole: 'INSPECTOR',
        status: 'ACCEPTED',
        priceCents: 15000,
        platformFeeBps: 1000,
        platformFeeCents: 1500,
        inspectorPayoutCents: 13500,
      });
      expect(Object.keys(res.body).sort()).toEqual(KEYS_BY_ROLE.INSPECTOR);
    });

    it('o vendedor confirma: 200 no formato do vendedor, AWAITING_PAYMENT e endereço sem espaços nas pontas', async () => {
      const id = await acceptedAppointment();

      const res = await act(seller, id, 'confirm', { meetingAddress: `   ${ADDRESS}   ` }).expect(200);

      expect(res.body).toMatchObject({ myRole: 'SELLER', status: 'AWAITING_PAYMENT', meetingAddress: ADDRESS });
      expect(Object.keys(res.body).sort()).toEqual(KEYS_BY_ROLE.SELLER);
      const saved = await prisma.appointment.findUniqueOrThrow({ where: { id } });
      expect(saved.meetingAddress).toBe(ADDRESS);
    });

    it.each(['BUYER', 'SELLER', 'INSPECTOR'] as const)(
      'GET /appointments/:id para %s devolve exatamente as chaves do seu papel',
      async (role) => {
        const id = await awaitingPaymentAppointment();

        const res = await getOne(userFor(role), id).expect(200);

        expect(res.body).toMatchObject({ id, myRole: role, status: 'AWAITING_PAYMENT' });
        expect(Object.keys(res.body).sort()).toEqual(KEYS_BY_ROLE[role]);
      },
    );

    it('nenhuma resposta do fluxo traz id de usuário (nem buyerId/sellerId/inspectorUserId, nem os valores)', async () => {
      const listingId = await createListing();
      const created = await requestAppointment(listingId).expect(201);
      const id = (created.body as { id: string }).id;
      const accepted = await act(inspector, id, 'accept').expect(200);
      const confirmed = await act(seller, id, 'confirm', { meetingAddress: ADDRESS }).expect(200);
      const bodies: unknown[] = [created.body, accepted.body, confirmed.body];
      for (const user of [buyer, seller, inspector]) {
        bodies.push((await getOne(user, id).expect(200)).body);
        bodies.push((await request(app.getHttpServer()).get('/appointments').set(auth(user)).expect(200)).body);
      }

      for (const body of bodies) expectNoUserIds(body);
    });

    describe('OpenAPI (/docs-json)', () => {
      const ref = (name: string) => `#/components/schemas/${name}`;

      it('o 200 de GET /appointments/{id} é oneOf dos 3 perfis com discriminador myRole', async () => {
        const res = await request(app.getHttpServer()).get('/docs-json').expect(200);

        const schema = res.body.paths['/appointments/{id}'].get.responses['200'].content['application/json'].schema;
        expect(schema.oneOf).toEqual([
          { $ref: ref('BuyerAppointmentResponseDto') },
          { $ref: ref('SellerAppointmentResponseDto') },
          { $ref: ref('InspectorAppointmentResponseDto') },
        ]);
        expect(schema.discriminator).toEqual({
          propertyName: 'myRole',
          mapping: {
            BUYER: ref('BuyerAppointmentResponseDto'),
            SELLER: ref('SellerAppointmentResponseDto'),
            INSPECTOR: ref('InspectorAppointmentResponseDto'),
          },
        });
      });

      it.each([
        ['SellerAppointmentResponseDto', 'SELLER'],
        ['BuyerAppointmentResponseDto', 'BUYER'],
        ['InspectorAppointmentResponseDto', 'INSPECTOR'],
      ] as const)('o schema %s tem exatamente as propriedades do papel %s', async (name, role) => {
        const res = await request(app.getHttpServer()).get('/docs-json').expect(200);

        const schema = res.body.components.schemas[name];
        expect(Object.keys(schema.properties).sort()).toEqual(KEYS_BY_ROLE[role]);
        expect(schema.properties.myRole.enum).toEqual([role]);
      });
    });

    describe('GET /appointments (filtros)', () => {
      /** Comprador num agendamento (anúncio da Vera) e vendedor em outro (anúncio dele, pedido pela Vera). */
      async function buyerInBothRoles(): Promise<{ asBuyer: string; asSeller: string }> {
        const asBuyer = await requestedAppointment();
        const buyersListing = await createListingAs(buyer);
        const res = await requestAs(seller, buyersListing, hoursFromNow(72)).expect(201);
        return { asBuyer, asSeller: (res.body as { id: string }).id };
      }

      it('sem filtro traz os agendamentos em que o usuário participa, cada um no formato do seu papel', async () => {
        const { asBuyer, asSeller } = await buyerInBothRoles();

        const res = await request(app.getHttpServer()).get('/appointments').set(auth(buyer)).expect(200);

        expect(res.body).toMatchObject({ total: 2, page: 1, limit: 20 });
        const roles = Object.fromEntries(
          (res.body.items as { id: string; myRole: string }[]).map((i) => [i.id, i.myRole]),
        );
        expect(roles).toEqual({ [asBuyer]: 'BUYER', [asSeller]: 'SELLER' });
      });

      it.each([
        ['BUYER', 'asBuyer'],
        ['SELLER', 'asSeller'],
      ] as const)('?as=%s traz só os agendamentos em que o usuário tem esse papel', async (as, key) => {
        const ids = await buyerInBothRoles();

        const res = await request(app.getHttpServer())
          .get('/appointments')
          .query({ as })
          .set(auth(buyer))
          .expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0]).toMatchObject({ id: ids[key], myRole: as });
      });

      it('?status=ACCEPTED traz só os aceitos', async () => {
        const { asBuyer } = await buyerInBothRoles();
        await act(inspector, asBuyer, 'accept').expect(200);

        const res = await request(app.getHttpServer())
          .get('/appointments')
          .query({ status: 'ACCEPTED' })
          .set(auth(buyer))
          .expect(200);

        expect(res.body.total).toBe(1);
        expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([asBuyer]);
      });

      it('responde 400 no formato de validação com limit=51', async () => {
        const res = await request(app.getHttpServer())
          .get('/appointments')
          .query({ limit: 51 })
          .set(auth(buyer))
          .expect(400);

        expect(res.body.message).toBe('Dados inválidos');
        expect(Object.keys(res.body).sort()).toEqual(VALIDATION_ERROR_KEYS);
        expect(res.body.errors).toEqual(['limit must not be greater than 50']);
      });
    });
  });

  describe('POST /appointments: regras de confiança', () => {
    async function expectError(
      res: request.Response,
      statusCode: number,
      message: string,
    ): Promise<void> {
      expect(res.status).toBe(statusCode);
      expect(res.body.message).toBe(message);
      expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
      expect(await prisma.appointment.count()).toBe(0);
    }

    it.each(['2030-W02-4T14:00:00Z', '2030-010T14:00:00Z'])(
      'responde 400 (não 500) para startsAt ISO 8601 que não vira data válida: %s',
      async (startsAt) => {
        const listingId = await createListing();

        await expectError(
          await requestAppointment(listingId, startsAt),
          400,
          'startsAt inválido: use data e hora no formato aaaa-mm-ddThh:mm:ss com fuso (Z ou ±hh:mm)',
        );
      },
    );

    it('responde 404 "Anúncio não encontrado" quando o anúncio está PAUSED', async () => {
      const listingId = await createListing();
      await request(app.getHttpServer()).post(`/listings/${listingId}/pause`).set(auth(seller)).expect(200);

      await expectError(await requestAppointment(listingId), 404, 'Anúncio não encontrado');
    });

    it('responde 404 "Avaliador não encontrado" quando o avaliador não é verificado', async () => {
      const listingId = await createListing();
      const unverified = await registerAndLogin(app, 'naoverificado@x.com', 'Nico Não Verificado');
      const profile = await request(app.getHttpServer())
        .post('/inspectors/me')
        .set(auth(unverified))
        .send(inspectorProfilePayload)
        .expect(201);

      const res = await requestAs(buyer, listingId, hoursFromNow(48), profile.body.id);

      await expectError(res, 404, 'Avaliador não encontrado');
    });

    it('responde 403 quando o comprador é o vendedor do anúncio', async () => {
      const listingId = await createListing();

      await expectError(
        await requestAs(seller, listingId),
        403,
        'Você não pode agendar avaliação do seu próprio anúncio',
      );
    });

    it('responde 403 quando o avaliador é o próprio comprador', async () => {
      const listingId = await createListing();

      await expectError(
        await requestAs(inspector, listingId),
        403,
        'Você não pode agendar uma avaliação consigo mesmo',
      );
    });

    it('responde 409 quando o avaliador é o vendedor do anúncio', async () => {
      const inspectorsListing = await createListingAs(inspector);

      await expectError(
        await requestAs(buyer, inspectorsListing),
        409,
        'Este avaliador não está disponível para este anúncio',
      );
    });

    it('responde 400 com menos de 24 horas de antecedência', async () => {
      const listingId = await createListing();

      await expectError(
        await requestAppointment(listingId, hoursFromNow(23)),
        400,
        'O agendamento precisa de pelo menos 24 horas de antecedência',
      );
    });

    it('responde 400 com mais de 60 dias de antecedência', async () => {
      const listingId = await createListing();

      await expectError(
        await requestAppointment(listingId, hoursFromNow(60 * 24 + 1)),
        400,
        'O agendamento pode ser feito com no máximo 60 dias de antecedência',
      );
    });

    it('responde 400 quando startsAt não tem fuso horário', async () => {
      const listingId = await createListing();

      const res = await requestAppointment(listingId, hoursFromNow(48).replace('Z', '')).expect(400);

      expect(res.body.message).toBe('Dados inválidos');
      expect(res.body.errors).toEqual(['startsAt must include a timezone (Z or ±hh:mm)']);
      expect(await prisma.appointment.count()).toBe(0);
    });

    it('responde 409 "Este avaliador está indisponível no momento" quando o preço do avaliador está abaixo do mínimo', async () => {
      const listingId = await createListing();
      // A API já bloqueia preço < 5000 no perfil: o valor antigo é posto direto no banco.
      await prisma.inspectorProfile.update({
        where: { id: inspector.profileId },
        data: { basePriceCents: 4999 },
      });

      await expectError(await requestAppointment(listingId), 409, 'Este avaliador está indisponível no momento');
    });

    it('responde 409 quando o horário se sobrepõe a um agendamento ACCEPTED do mesmo avaliador', async () => {
      const listingId = await createListing();
      const other = await registerAndLogin(app, 'outro@x.com', 'Otto Comprador');
      const startsAt = new Date(hoursFromNow(48));
      const taken = await requestAs(other, listingId, startsAt.toISOString()).expect(201);
      await act(inspector, taken.body.id, 'accept').expect(200);

      const res = await requestAppointment(listingId, hoursFromNow(0.5, startsAt));

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('O avaliador não está disponível nesse horário');
      expect(await prisma.appointment.count()).toBe(1);
    });

    it(`responde 409 a pedido duplicado em andamento (prova que ${APPOINTMENT_OPEN_TRIPLET_INDEX} é o nome do índice da migration)`, async () => {
      const listingId = await createListing();
      await requestAppointment(listingId, hoursFromNow(48)).expect(201);

      const res = await requestAppointment(listingId, hoursFromNow(96));

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Você já tem um agendamento em andamento para este anúncio com este avaliador');
      expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
      expect(await prisma.appointment.count()).toBe(1);
    });
  });

  describe('whitelist dos campos', () => {
    it.each([
      ['status', 'ACCEPTED'],
      ['priceCents', 1],
      ['buyerId', '00000000-0000-4000-8000-000000000001'],
      ['sellerId', '00000000-0000-4000-8000-000000000002'],
    ])('POST /appointments com %s responde 400 "Dados inválidos" e não cria nada', async (field, value) => {
      const listingId = await createListing();

      const res = await request(app.getHttpServer())
        .post('/appointments')
        .set(auth(buyer))
        .send({ listingId, inspectorProfileId: inspector.profileId, startsAt: hoursFromNow(48), [field]: value })
        .expect(400);

      expect(res.body.message).toBe('Dados inválidos');
      expect(Object.keys(res.body).sort()).toEqual(VALIDATION_ERROR_KEYS);
      expect(res.body.errors).toEqual([`property ${field} should not exist`]);
      expect(await prisma.appointment.count()).toBe(0);
    });

    it('confirm com campo extra responde 400 e não muda o estado', async () => {
      const id = await acceptedAppointment();

      const res = await act(seller, id, 'confirm', { meetingAddress: ADDRESS, status: 'PAID' }).expect(400);

      expect(res.body.message).toBe('Dados inválidos');
      expect(res.body.errors).toEqual(['property status should not exist']);
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('ACCEPTED');
    });
  });

  describe('privacidade e estado', () => {
    it('terceiro (não participante) recebe 404 em GET /appointments/:id', async () => {
      const id = await requestedAppointment();
      const third = await registerAndLogin(app, 'terceiro@x.com', 'Tereza Terceira');

      const res = await getOne(third, id).expect(404);

      expect(res.body.message).toBe(NOT_FOUND);
      expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
    });

    it.each(['accept', 'decline', 'confirm', 'cancel'] as const)(
      'terceiro (não participante) recebe 404 em %s e nada muda',
      async (action) => {
        const id = await requestedAppointment();
        const third = await registerAndLogin(app, 'terceiro@x.com', 'Tereza Terceira');

        // Só o confirm lê o corpo; as outras ações o ignoram.
        const res = await act(third, id, action, { meetingAddress: ADDRESS }).expect(404);

        expect(res.body.message).toBe(NOT_FOUND);
        expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('REQUESTED');
      },
    );

    it.each(['BUYER', 'SELLER'] as const)('%s recebe 403 ao tentar aceitar', async (role) => {
      const id = await requestedAppointment();

      const res = await act(userFor(role), id, 'accept').expect(403);

      expect(res.body.message).toBe('Você não pode aceitar este agendamento');
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('REQUESTED');
    });

    it('o avaliador recebe 403 ao tentar confirmar', async () => {
      const id = await acceptedAppointment();

      const res = await act(inspector, id, 'confirm', { meetingAddress: ADDRESS }).expect(403);

      expect(res.body.message).toBe('Você não pode confirmar este agendamento');
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('ACCEPTED');
    });

    it('confirm em REQUESTED responde 409 "Ação não permitida no estado atual"', async () => {
      const id = await requestedAppointment();

      const res = await act(seller, id, 'confirm', { meetingAddress: ADDRESS }).expect(409);

      expect(res.body.message).toBe('Ação não permitida no estado atual');
      expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('REQUESTED');
    });

    it('cancel depois de CANCELLED responde 409 e mantém quem cancelou', async () => {
      const id = await requestedAppointment();
      await act(buyer, id, 'cancel').expect(200);

      const res = await act(seller, id, 'cancel').expect(409);

      expect(res.body.message).toBe('Ação não permitida no estado atual');
      const saved = await prisma.appointment.findUniqueOrThrow({ where: { id } });
      expect(saved).toMatchObject({ status: 'CANCELLED', endedBy: 'BUYER' });
    });

    it('responde 400 quando o id não é uuid', async () => {
      const res = await getOne(buyer, 'nao-e-uuid').expect(400);

      expect(res.body.message).toBe('Validation failed (uuid is expected)');
      expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
    });

    it.each([
      ['get', '/appointments'],
      ['get', '/appointments/00000000-0000-4000-8000-000000000000'],
      ['post', '/appointments'],
      ['post', '/appointments/00000000-0000-4000-8000-000000000000/cancel'],
    ] as const)('responde 401 sem token em %s %s', async (method, path) => {
      const res = await request(app.getHttpServer())[method](path).expect(401);

      expect(Object.keys(res.body).sort()).toEqual(ERROR_KEYS);
    });
  });

  describe('concorrência (nunca 500)', () => {
    const ROUNDS = 6;

    it('dois accepts simultâneos de horários sobrepostos: um 200, um 409 e exatamente um ACCEPTED', async () => {
      const listingId = await createListing();
      const other = await registerAndLogin(app, 'outro@x.com', 'Otto Comprador');
      for (let round = 0; round < ROUNDS; round++) {
        await prisma.appointment.deleteMany();
        const startsAt = new Date(hoursFromNow(48));
        const first = await requestAs(buyer, listingId, startsAt.toISOString()).expect(201);
        const second = await requestAs(other, listingId, hoursFromNow(0.5, startsAt)).expect(201);

        const responses = await Promise.all([
          act(inspector, first.body.id, 'accept'),
          act(inspector, second.body.id, 'accept'),
        ]);

        const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
        expect(statuses, `rodada ${round}`).toEqual([200, 409]);
        const loser = responses.find((r) => r.status === 409);
        expect(RACE_MESSAGES, `rodada ${round}`).toContain(loser?.body.message);
        expect(await prisma.appointment.count({ where: { status: 'ACCEPTED' } }), `rodada ${round}`).toBe(1);
        expect(await prisma.appointment.count({ where: { status: 'REQUESTED' } }), `rodada ${round}`).toBe(1);
      }
    });

    it('accept e cancel simultâneos: estado final coerente com quem venceu (ACCEPTED ou CANCELLED)', async () => {
      // O comprador pode cancelar um ACCEPTED: se o accept terminar antes do
      // cancel ler, os dois dão 200 e o final é CANCELLED.
      const allowed = [
        { accept: 200, cancel: 409, final: 'ACCEPTED', endedBy: null },
        { accept: 409, cancel: 200, final: 'CANCELLED', endedBy: 'BUYER' },
        { accept: 200, cancel: 200, final: 'CANCELLED', endedBy: 'BUYER' },
      ];
      const listingId = await createListing();
      for (let round = 0; round < ROUNDS; round++) {
        await prisma.appointment.deleteMany();
        const id = await requestedAppointment(listingId);

        const [accepted, cancelled] = await Promise.all([act(inspector, id, 'accept'), act(buyer, id, 'cancel')]);

        const saved = await prisma.appointment.findUniqueOrThrow({ where: { id } });
        expect(allowed, `rodada ${round}`).toContainEqual({
          accept: accepted.status,
          cancel: cancelled.status,
          final: saved.status,
          endedBy: saved.endedBy,
        });
        const conflicts = [accepted, cancelled].filter((r) => r.status === 409).map((r) => r.body.message);
        for (const message of conflicts) expect(RACE_MESSAGES, `rodada ${round}`).toContain(message);
      }
    });

    it('dois POST iguais simultâneos: um 201, um 409 e um único registro', async () => {
      const listingId = await createListing();
      for (let round = 0; round < ROUNDS; round++) {
        await prisma.appointment.deleteMany();
        const startsAt = hoursFromNow(48);

        const responses = await Promise.all([
          requestAppointment(listingId, startsAt),
          requestAppointment(listingId, startsAt),
        ]);

        const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
        expect(statuses, `rodada ${round}`).toEqual([201, 409]);
        expect(responses.find((r) => r.status === 409)?.body.message).toBe(
          'Você já tem um agendamento em andamento para este anúncio com este avaliador',
        );
        expect(await prisma.appointment.count(), `rodada ${round}`).toBe(1);
      }
    });
  });
});
