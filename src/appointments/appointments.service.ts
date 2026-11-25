import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CLOCK } from '../common/clock/clock.js';
import type { Clock } from '../common/clock/clock.js';
import { ErrorCode, withCode } from '../common/errors/error-code.js';
import { splitPlatformFee } from '../common/money/platform-fee.js';
import { isUniqueViolationOn } from '../common/prisma/prisma-errors.js';
import { BUSINESS_RULES } from '../config/business-rules.js';
import type { BusinessRules } from '../config/business-rules.js';
import type { AppointmentStatus, ListingStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deadlineFor, dueWhere, expiredData, isDue } from './appointment-deadlines.js';
import { APPOINTMENT_INCLUDE } from './appointment.include.js';
import {
  APPOINTMENT_OPEN_TRIPLET_INDEX,
  EXPIRABLE_STATUSES,
  EXPIRING_SLOT_STATUSES,
  MAX_ADVANCE_DAYS,
  OPEN_TRIPLET_STATUSES,
} from './appointments.constants.js';
import { decide, participantOf } from './appointments.state-machine.js';
import type { AppointmentAction, Participant } from './appointments.state-machine.js';
import {
  appointmentResponseFor,
  BuyerAppointmentResponseDto,
  InspectorAppointmentResponseDto,
  SellerAppointmentResponseDto,
} from './dto/appointment-response.dto.js';
import type { ConfirmAppointmentDto } from './dto/confirm-appointment.dto.js';
import type { AppointmentResponseDto } from './dto/appointment-response.dto.js';
import type { ListAppointmentsQueryDto } from './dto/list-appointments-query.dto.js';
import type { PaginatedAppointmentsResponseDto } from './dto/paginated-appointments-response.dto.js';
import type { CreateAppointmentDto } from './dto/create-appointment.dto.js';

const NOT_FOUND_MESSAGE = 'Agendamento não encontrado';
const DUPLICATE_MESSAGE = 'Você já tem um agendamento em andamento para este anúncio com este avaliador';

/** Campo do agendamento que guarda o usuário de cada papel. */
const PARTICIPANT_FIELD: Record<Participant, 'buyerId' | 'sellerId' | 'inspectorUserId'> = {
  BUYER: 'buyerId',
  SELLER: 'sellerId',
  INSPECTOR: 'inspectorUserId',
};

/** Verbo da mensagem de 403 de cada ação com rota. */
const ACTION_VERB: Record<'ACCEPT' | 'DECLINE' | 'CONFIRM' | 'CANCEL', string> = {
  ACCEPT: 'aceitar',
  DECLINE: 'recusar',
  CONFIRM: 'confirmar',
  CANCEL: 'cancelar',
};

type RouteAction = keyof typeof ACTION_VERB;

/** O que a transição lê do agendamento antes de decidir. */
type TransitionSnapshot = {
  id: string;
  buyerId: string;
  sellerId: string;
  inspectorUserId: string;
  status: AppointmentStatus;
  startsAt: Date;
  expiresAt: Date | null;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BUSINESS_RULES) private readonly rules: BusinessRules,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Cria o pedido de avaliação (REQUESTED), com as checagens na ordem do
   * desenho (docs/appointments-design.md, seção 5). O anúncio fica travado
   * com FOR SHARE durante a transação, para não sair de ACTIVE no meio.
   */
  async create(buyerId: string, dto: CreateAppointmentDto): Promise<BuyerAppointmentResponseDto> {
    const now = this.clock.now();
    const startsAt = new Date(dto.startsAt);
    // O @IsISO8601 aceita formatos (semana, dia ordinal) que o Date não entende.
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException(
        withCode(
          ErrorCode.INVALID_SCHEDULE,
          'startsAt inválido: use data e hora no formato aaaa-mm-ddThh:mm:ss com fuso (Z ou ±hh:mm)',
        ),
      );
    }
    this.assertSchedulingWindow(now, startsAt);
    const endsAt = new Date(startsAt.getTime() + this.rules.appointmentDurationMinutes * 60_000);

    let appointmentId: string;
    try {
      appointmentId = await this.prisma.$transaction(async (tx) => {
        const [listing] = await tx.$queryRaw<{ sellerId: string; status: ListingStatus }[]>`
          SELECT "sellerId", "status"::text AS "status"
          FROM "Listing" WHERE "id" = ${dto.listingId}
          FOR SHARE`;
        if (!listing || listing.status !== 'ACTIVE') {
          throw new NotFoundException(withCode(ErrorCode.LISTING_NOT_FOUND, 'Anúncio não encontrado'));
        }
        if (listing.sellerId === buyerId) {
          throw new ForbiddenException(
            withCode(ErrorCode.FORBIDDEN, 'Você não pode agendar avaliação do seu próprio anúncio'),
          );
        }

        const inspector = await tx.inspectorProfile.findFirst({
          where: { id: dto.inspectorProfileId, verified: true },
          select: { userId: true, basePriceCents: true },
        });
        if (!inspector) throw new NotFoundException(withCode(ErrorCode.INSPECTOR_NOT_FOUND, 'Avaliador não encontrado'));
        if (inspector.userId === buyerId) {
          throw new ForbiddenException(
            withCode(ErrorCode.FORBIDDEN, 'Você não pode agendar uma avaliação consigo mesmo'),
          );
        }
        if (inspector.userId === listing.sellerId) {
          throw new ConflictException(
            withCode(ErrorCode.INSPECTOR_UNAVAILABLE, 'Este avaliador não está disponível para este anúncio'),
          );
        }
        if (inspector.basePriceCents < this.rules.minInspectionPriceCents) {
          throw new ConflictException(
            withCode(ErrorCode.INSPECTOR_UNAVAILABLE, 'Este avaliador está indisponível no momento'),
          );
        }

        // Pedido duplicado antes do horário: com um pedido em andamento, a
        // resposta é sempre a mesma e não revela a agenda do avaliador. A
        // garantia contra corrida é o índice único parcial (P2002 abaixo).
        const duplicate = await tx.appointment.findFirst({
          where: {
            buyerId,
            listingId: dto.listingId,
            inspectorUserId: inspector.userId,
            status: { in: OPEN_TRIPLET_STATUSES },
          },
          select: { id: true },
        });
        if (duplicate) throw new ConflictException(withCode(ErrorCode.APPOINTMENT_DUPLICATE, DUPLICATE_MESSAGE));

        // Checagem branda: a garantia é a exclusion constraint, aplicada no
        // aceite. PAID ocupa sempre; ACCEPTED/AWAITING_PAYMENT só se não venceram.
        const busy = await tx.appointment.findFirst({
          where: {
            inspectorUserId: inspector.userId,
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            OR: [
              { status: 'PAID' },
              { status: { in: EXPIRING_SLOT_STATUSES }, expiresAt: { gt: now } },
            ],
          },
          select: { id: true },
        });
        if (busy) {
          throw new ConflictException(
            withCode(ErrorCode.SLOT_UNAVAILABLE, 'O avaliador não está disponível nesse horário'),
          );
        }

        const fee = splitPlatformFee(inspector.basePriceCents, this.rules.platformFeeBps);
        const created = await tx.appointment.create({
          data: {
            listingId: dto.listingId,
            buyerId,
            sellerId: listing.sellerId,
            inspectorUserId: inspector.userId,
            status: 'REQUESTED',
            startsAt,
            endsAt,
            expiresAt: deadlineFor('REQUESTED', now, startsAt),
            priceCents: inspector.basePriceCents,
            platformFeeBps: this.rules.platformFeeBps,
            platformFeeCents: fee.platformFeeCents,
            inspectorPayoutCents: fee.inspectorPayoutCents,
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      if (isUniqueViolationOn(error, APPOINTMENT_OPEN_TRIPLET_INDEX)) {
        throw new ConflictException(withCode(ErrorCode.APPOINTMENT_DUPLICATE, DUPLICATE_MESSAGE));
      }
      throw error;
    }

    const appointment = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: APPOINTMENT_INCLUDE,
    });
    return BuyerAppointmentResponseDto.from(appointment);
  }

  /**
   * Agendamentos em que o usuário participa (ou só num papel, com `as`).
   * O filtro do usuário está sempre no where; cada item sai no formato do
   * papel dele naquele agendamento. Ordem estável: mais recentes primeiro,
   * com o id como desempate.
   */
  async list(userId: string, query: ListAppointmentsQueryDto): Promise<PaginatedAppointmentsResponseDto> {
    const { as, status, page, limit } = query;
    const where: Prisma.AppointmentWhereInput = {
      ...(as
        ? { [PARTICIPANT_FIELD[as]]: userId }
        : { OR: [{ buyerId: userId }, { sellerId: userId }, { inspectorUserId: userId }] }),
      ...(status && { status }),
    };

    const [appointments, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        include: APPOINTMENT_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return {
      items: appointments.map((appointment) =>
        appointmentResponseFor(participantOf(appointment, userId) as Participant, appointment),
      ),
      total,
      page,
      limit,
    };
  }

  /** Detalhe: 404 quando não existe ou quando o usuário não participa (recurso privado). */
  async findOne(id: string, userId: string): Promise<AppointmentResponseDto> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id },
      include: APPOINTMENT_INCLUDE,
    });
    const role = appointment && participantOf(appointment, userId);
    if (!appointment || !role) throw new NotFoundException(withCode(ErrorCode.APPOINTMENT_NOT_FOUND, NOT_FOUND_MESSAGE));
    return appointmentResponseFor(role, appointment);
  }

  /** Avaliador aceita: ocupa o horário (a exclusion constraint é a garantia final). */
  async accept(id: string, userId: string): Promise<InspectorAppointmentResponseDto> {
    const { snapshot, now } = await this.prepare(id, userId, 'ACCEPT');

    await this.prisma.$transaction(async (tx) => {
      // Aceites do mesmo avaliador entram em fila: sem este lock, dois aceites
      // sobrepostos gravam ao mesmo tempo e cada um espera o outro na exclusion
      // constraint (deadlock 40P01, risco 82). Com ele, o segundo vê o primeiro
      // já gravado e recebe o 23P01 (SLOT_UNAVAILABLE). FOR NO KEY UPDATE é o
      // modo mínimo que conflita consigo mesmo, sem bloquear checagens de FK.
      // Invariante: o lock do perfil é sempre a primeira instrução da
      // transação. Quem travasse uma linha de Appointment antes e o perfil
      // depois poderia fechar um ciclo de deadlock com este caminho.
      await tx.$queryRaw`
        SELECT 1 FROM "InspectorProfile" WHERE "userId" = ${snapshot.inspectorUserId}
        FOR NO KEY UPDATE`;

      // Verificação no momento do aceite (o perfil pode ter perdido o verified).
      const profile = await tx.inspectorProfile.findUnique({
        where: { userId: snapshot.inspectorUserId },
        select: { verified: true },
      });
      if (!profile?.verified) {
        throw new ConflictException(
          withCode(ErrorCode.INSPECTOR_NOT_VERIFIED, 'Seu perfil de avaliador precisa estar verificado para aceitar'),
        );
      }

      // Libera horários presos por agendamentos do mesmo avaliador que já
      // venceram e o job ainda não varreu; senão a constraint daria um falso 409.
      // Nunca toca em PAID (EXPIRE não sai de PAID).
      await tx.appointment.updateMany({
        // Só os que ocupam horário: REQUESTED de outros compradores não entra.
        where: {
          inspectorUserId: snapshot.inspectorUserId,
          ...dueWhere(now, EXPIRING_SLOT_STATUSES),
        },
        data: expiredData(now),
      });

      // Uma violação 23P01 aqui sobe até o filtro global (409).
      await this.write(tx, snapshot, now, {
        status: 'ACCEPTED',
        acceptedAt: now,
        expiresAt: deadlineFor('ACCEPTED', now, snapshot.startsAt),
      });
    });

    return InspectorAppointmentResponseDto.from(await this.load(id));
  }

  /** Avaliador recusa o pedido. */
  async decline(id: string, userId: string): Promise<InspectorAppointmentResponseDto> {
    const { snapshot, now } = await this.prepare(id, userId, 'DECLINE');
    await this.write(this.prisma, snapshot, now, {
      status: 'DECLINED',
      endedBy: 'INSPECTOR',
      endedAt: now,
    });
    return InspectorAppointmentResponseDto.from(await this.load(id));
  }

  /** Vendedor confirma local e horário; abre a janela de pagamento. */
  async confirm(id: string, userId: string, dto: ConfirmAppointmentDto): Promise<SellerAppointmentResponseDto> {
    const { snapshot, now } = await this.prepare(id, userId, 'CONFIRM');
    await this.write(this.prisma, snapshot, now, {
      status: 'AWAITING_PAYMENT',
      meetingAddress: dto.meetingAddress,
      confirmedAt: now,
      expiresAt: deadlineFor('AWAITING_PAYMENT', now, snapshot.startsAt),
    });
    return SellerAppointmentResponseDto.from(await this.load(id));
  }

  /** Qualquer participante cancela antes do pagamento. */
  async cancel(id: string, userId: string): Promise<AppointmentResponseDto> {
    const { snapshot, now, role } = await this.prepare(id, userId, 'CANCEL');
    await this.write(this.prisma, snapshot, now, {
      status: 'CANCELLED',
      endedBy: role,
      endedAt: now,
    });
    return appointmentResponseFor(role, await this.load(id));
  }

  /**
   * Checagens comuns às ações, na ordem do desenho: 404 se não participa,
   * 403 se o papel não pode, 409 se o estado não permite e 409 se o prazo
   * venceu. No prazo vencido, grava EXPIRED antes de lançar e fora de
   * qualquer transação, para o rollback não desfazer a expiração.
   */
  private async prepare(id: string, userId: string, action: RouteAction) {
    const now = this.clock.now();
    const snapshot: TransitionSnapshot | null = await this.prisma.appointment.findUnique({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        inspectorUserId: true,
        status: true,
        startsAt: true,
        expiresAt: true,
      },
    });
    const role = snapshot && participantOf(snapshot, userId);
    if (!snapshot || !role) throw new NotFoundException(withCode(ErrorCode.APPOINTMENT_NOT_FOUND, NOT_FOUND_MESSAGE));

    const decision = decide(role, action as AppointmentAction, snapshot.status);
    if (!decision.ok) {
      throw decision.reason === 'FORBIDDEN_ACTOR'
        ? new ForbiddenException(
            withCode(ErrorCode.FORBIDDEN, `Você não pode ${ACTION_VERB[action]} este agendamento`),
          )
        : new ConflictException(withCode(ErrorCode.INVALID_STATE, 'Ação não permitida no estado atual'));
    }

    if (isDue(snapshot.status, snapshot.expiresAt, now)) {
      await this.prisma.appointment.updateMany({
        where: { id, ...dueWhere(now, snapshot.status) },
        data: expiredData(now),
      });
      throw new ConflictException(withCode(ErrorCode.APPOINTMENT_EXPIRED, 'O prazo para esta ação expirou'));
    }

    return { snapshot, now, role };
  }

  /**
   * Grava a transição só se o estado ainda for o lido e o prazo não tiver
   * vencido (proteção contra corrida). Nada alterado: 409.
   */
  private async write(
    db: Pick<PrismaService, 'appointment'>,
    snapshot: TransitionSnapshot,
    now: Date,
    data: Prisma.AppointmentUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await db.appointment.updateMany({
      where: {
        id: snapshot.id,
        status: snapshot.status,
        ...(EXPIRABLE_STATUSES.includes(snapshot.status) && { expiresAt: { gt: now } }),
      },
      data,
    });
    if (count === 0) {
      throw new ConflictException(
        withCode(ErrorCode.STATE_CHANGED, 'O agendamento mudou de estado; recarregue e tente novamente'),
      );
    }
  }

  private load(id: string) {
    return this.prisma.appointment.findUniqueOrThrow({ where: { id }, include: APPOINTMENT_INCLUDE });
  }

  /** 400 se o início não respeitar a antecedência mínima ou o horizonte de 60 dias. */
  private assertSchedulingWindow(now: Date, startsAt: Date): void {
    const minNoticeHours = this.rules.appointmentMinNoticeHours;
    if (startsAt.getTime() < now.getTime() + minNoticeHours * HOUR_MS) {
      throw new BadRequestException(
        withCode(
          ErrorCode.INVALID_SCHEDULE,
          minNoticeHours === 0
            ? 'O horário do agendamento precisa estar no futuro'
            : `O agendamento precisa de pelo menos ${minNoticeHours} ${minNoticeHours === 1 ? 'hora' : 'horas'} de antecedência`,
        ),
      );
    }
    if (startsAt.getTime() > now.getTime() + MAX_ADVANCE_DAYS * DAY_MS) {
      throw new BadRequestException(
        withCode(
          ErrorCode.INVALID_SCHEDULE,
          `O agendamento pode ser feito com no máximo ${MAX_ADVANCE_DAYS} dias de antecedência`,
        ),
      );
    }
  }
}
