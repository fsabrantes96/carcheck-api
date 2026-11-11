import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FakeClock } from '../../test/support/fake-clock.js';
import { partialUniqueViolation } from '../../test/support/prisma-error-fixtures.js';
import type { BusinessRules } from '../config/business-rules.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AppointmentsService } from './appointments.service.js';
import { BuyerAppointmentResponseDto } from './dto/appointment-response.dto.js';
import type { CreateAppointmentDto } from './dto/create-appointment.dto.js';

const NOW = '2030-01-01T12:00:00.000Z';
const LISTING_ID = '11111111-1111-4111-8111-111111111111';
const PROFILE_ID = '22222222-2222-4222-8222-222222222222';

const rules: BusinessRules = {
  platformFeeBps: 1000,
  minInspectionPriceCents: 5000,
  appointmentDurationMinutes: 60,
  appointmentMinNoticeHours: 24,
};

function dto(overrides: Partial<CreateAppointmentDto> = {}): CreateAppointmentDto {
  return {
    listingId: LISTING_ID,
    inspectorProfileId: PROFILE_ID,
    startsAt: '2030-01-03T12:00:00.000Z',
    ...overrides,
  };
}

/** Agendamento carregado com APPOINTMENT_INCLUDE, como o Prisma devolve. */
function loadedAppointment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    listingId: LISTING_ID,
    buyerId: 'buyer',
    sellerId: 'seller',
    inspectorUserId: 'inspector',
    status: 'REQUESTED',
    startsAt: new Date('2030-01-03T12:00:00.000Z'),
    endsAt: new Date('2030-01-03T13:00:00.000Z'),
    expiresAt: new Date('2030-01-02T12:00:00.000Z'),
    meetingAddress: null,
    priceCents: 15000,
    platformFeeBps: 1000,
    platformFeeCents: 1500,
    inspectorPayoutCents: 13500,
    acceptedAt: null,
    confirmedAt: null,
    endedAt: null,
    endedBy: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    listing: { id: LISTING_ID, title: 'Gol 1.0 2018', city: 'Boituva', state: 'SP' },
    buyer: { name: 'Bruno Comprador' },
    seller: { name: 'Vera Vendedora' },
    inspector: { name: 'Ivo Avaliador', inspectorProfile: { id: PROFILE_ID } },
    ...overrides,
  };
}

type PrismaMock = {
  $transaction: ReturnType<typeof vi.fn>;
  $queryRaw: ReturnType<typeof vi.fn>;
  inspectorProfile: { findFirst: ReturnType<typeof vi.fn> };
  appointment: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
};

describe('AppointmentsService.create', () => {
  let prisma: PrismaMock;
  let clock: FakeClock;
  let service: AppointmentsService;

  function build(overrides: Partial<BusinessRules> = {}) {
    service = new AppointmentsService(
      prisma as unknown as PrismaService,
      { ...rules, ...overrides },
      clock,
    );
  }

  beforeEach(() => {
    prisma = {
      $transaction: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([{ sellerId: 'seller', status: 'ACTIVE' }]),
      inspectorProfile: {
        findFirst: vi.fn().mockResolvedValue({ userId: 'inspector', basePriceCents: 15000 }),
      },
      appointment: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'a1' }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(loadedAppointment()),
      },
    };
    prisma.$transaction.mockImplementation((callback: (tx: PrismaMock) => Promise<unknown>) =>
      callback(prisma),
    );
    clock = new FakeClock(NOW);
    build();
  });

  async function expectRejection(
    promise: Promise<unknown>,
    type: new (...args: never[]) => Error,
    message: string,
  ) {
    await expect(promise).rejects.toBeInstanceOf(type);
    await expect(promise).rejects.toThrow(message);
  }

  describe('caminho feliz', () => {
    it('cria REQUESTED com valores congelados, vendedor copiado do anúncio, fim pela duração e prazo de 24h', async () => {
      await service.create('buyer', dto());

      expect(prisma.appointment.create).toHaveBeenCalledWith({
        data: {
          listingId: LISTING_ID,
          buyerId: 'buyer',
          sellerId: 'seller',
          inspectorUserId: 'inspector',
          status: 'REQUESTED',
          startsAt: new Date('2030-01-03T12:00:00.000Z'),
          endsAt: new Date('2030-01-03T13:00:00.000Z'),
          expiresAt: new Date('2030-01-02T12:00:00.000Z'),
          priceCents: 15000,
          platformFeeBps: 1000,
          platformFeeCents: 1500,
          inspectorPayoutCents: 13500,
        },
        select: { id: true },
      });
    });

    it('usa a duração configurada para calcular endsAt', async () => {
      build({ appointmentDurationMinutes: 90 });

      await service.create('buyer', dto());

      expect(prisma.appointment.create.mock.calls[0][0].data.endsAt).toEqual(
        new Date('2030-01-03T13:30:00.000Z'),
      );
    });

    it('trava o anúncio com SELECT ... FOR SHARE dentro da transação', async () => {
      await service.create('buyer', dto());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(strings.join('?')).toMatch(/FROM "Listing" WHERE "id" = \?\s+FOR SHARE/);
      expect(values).toEqual([LISTING_ID]);
    });

    it('procura o avaliador só entre os verificados', async () => {
      await service.create('buyer', dto());

      expect(prisma.inspectorProfile.findFirst).toHaveBeenCalledWith({
        where: { id: PROFILE_ID, verified: true },
        select: { userId: true, basePriceCents: true },
      });
    });

    it('devolve a resposta do comprador (myRole BUYER, com preço e sem comissão nem repasse)', async () => {
      const result = await service.create('buyer', dto());

      expect(result).toBeInstanceOf(BuyerAppointmentResponseDto);
      expect(result).toMatchObject({ id: 'a1', myRole: 'BUYER', priceCents: 15000, status: 'REQUESTED' });
      expect(result).not.toHaveProperty('platformFeeCents');
      expect(result).not.toHaveProperty('inspectorPayoutCents');
      expect(result).not.toHaveProperty('buyerId');
    });

    it('aceita exatamente a antecedência mínima (24h)', async () => {
      await expect(
        service.create('buyer', dto({ startsAt: '2030-01-02T12:00:00.000Z' })),
      ).resolves.toBeInstanceOf(BuyerAppointmentResponseDto);
    });

    it('aceita exatamente o horizonte máximo (60 dias)', async () => {
      await expect(
        service.create('buyer', dto({ startsAt: '2030-03-02T12:00:00.000Z' })),
      ).resolves.toBeInstanceOf(BuyerAppointmentResponseDto);
    });
  });

  describe('erros, na ordem do desenho', () => {
    it('400 com menos de 24h de antecedência, sem abrir transação', async () => {
      await expectRejection(
        service.create('buyer', dto({ startsAt: '2030-01-02T11:59:00.000Z' })),
        BadRequestException,
        'O agendamento precisa de pelo menos 24 horas de antecedência',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a mensagem da antecedência usa o valor configurado (1 hora, no singular)', async () => {
      build({ appointmentMinNoticeHours: 1 });

      await expectRejection(
        service.create('buyer', dto({ startsAt: '2030-01-01T12:30:00.000Z' })),
        BadRequestException,
        'O agendamento precisa de pelo menos 1 hora de antecedência',
      );
    });

    it('400 com mais de 60 dias de antecedência', async () => {
      await expectRejection(
        service.create('buyer', dto({ startsAt: '2030-03-02T12:00:00.001Z' })),
        BadRequestException,
        'O agendamento pode ser feito com no máximo 60 dias de antecedência',
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404 quando o anúncio não existe', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expectRejection(service.create('buyer', dto()), NotFoundException, 'Anúncio não encontrado');
    });

    it.each(['PAUSED', 'SOLD', 'ARCHIVED'])('404 quando o anúncio está %s', async (status) => {
      prisma.$queryRaw.mockResolvedValue([{ sellerId: 'seller', status }]);

      await expectRejection(service.create('buyer', dto()), NotFoundException, 'Anúncio não encontrado');
    });

    it('403 quando o comprador é o vendedor, antes de procurar o avaliador', async () => {
      await expectRejection(
        service.create('seller', dto()),
        ForbiddenException,
        'Você não pode agendar avaliação do seu próprio anúncio',
      );
      expect(prisma.inspectorProfile.findFirst).not.toHaveBeenCalled();
    });

    it('404 quando o avaliador não existe ou não está verificado', async () => {
      prisma.inspectorProfile.findFirst.mockResolvedValue(null);

      await expectRejection(service.create('buyer', dto()), NotFoundException, 'Avaliador não encontrado');
    });

    it('403 quando o avaliador é o próprio comprador', async () => {
      prisma.inspectorProfile.findFirst.mockResolvedValue({ userId: 'buyer', basePriceCents: 15000 });

      await expectRejection(
        service.create('buyer', dto()),
        ForbiddenException,
        'Você não pode agendar uma avaliação consigo mesmo',
      );
    });

    it('409 quando o avaliador é o vendedor (conflito de interesse)', async () => {
      prisma.inspectorProfile.findFirst.mockResolvedValue({ userId: 'seller', basePriceCents: 15000 });

      await expectRejection(
        service.create('buyer', dto()),
        ConflictException,
        'Este avaliador não está disponível para este anúncio',
      );
    });

    it('409 quando o preço do avaliador está abaixo do mínimo', async () => {
      prisma.inspectorProfile.findFirst.mockResolvedValue({ userId: 'inspector', basePriceCents: 4999 });

      await expectRejection(
        service.create('buyer', dto()),
        ConflictException,
        'Este avaliador está indisponível no momento',
      );
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('409 quando o horário do avaliador já está ocupado (checagem branda)', async () => {
      prisma.appointment.findFirst.mockResolvedValue({ id: 'outro' });

      await expectRejection(
        service.create('buyer', dto()),
        ConflictException,
        'O avaliador não está disponível nesse horário',
      );
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('a checagem branda considera só estados que ocupam horário, sobreposição e quem não venceu', async () => {
      await service.create('buyer', dto());

      expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
        where: {
          inspectorUserId: 'inspector',
          status: { in: ['ACCEPTED', 'AWAITING_PAYMENT', 'PAID'] },
          startsAt: { lt: new Date('2030-01-03T13:00:00.000Z') },
          endsAt: { gt: new Date('2030-01-03T12:00:00.000Z') },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(NOW) } }],
        },
        select: { id: true },
      });
    });

    it('409 quando já existe pedido em andamento do mesmo trio (P2002 do índice parcial)', async () => {
      prisma.appointment.create.mockRejectedValue(partialUniqueViolation('Appointment_open_triplet_key'));

      await expectRejection(
        service.create('buyer', dto()),
        ConflictException,
        'Você já tem um agendamento em andamento para este anúncio com este avaliador',
      );
    });

    it('repassa sem alteração um P2002 de outro índice', async () => {
      const other = partialUniqueViolation('Outro_indice');
      prisma.appointment.create.mockRejectedValue(other);

      await expect(service.create('buyer', dto())).rejects.toBe(other);
    });
  });
});
