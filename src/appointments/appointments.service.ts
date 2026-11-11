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
import { splitPlatformFee } from '../common/money/platform-fee.js';
import { isUniqueViolationOn } from '../common/prisma/prisma-errors.js';
import { BUSINESS_RULES } from '../config/business-rules.js';
import type { BusinessRules } from '../config/business-rules.js';
import type { ListingStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { deadlineFor } from './appointment-deadlines.js';
import { APPOINTMENT_INCLUDE } from './appointment.include.js';
import {
  APPOINTMENT_OPEN_TRIPLET_INDEX,
  MAX_ADVANCE_DAYS,
  SLOT_OCCUPYING_STATUSES,
} from './appointments.constants.js';
import { BuyerAppointmentResponseDto } from './dto/appointment-response.dto.js';
import type { CreateAppointmentDto } from './dto/create-appointment.dto.js';

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
          throw new NotFoundException('Anúncio não encontrado');
        }
        if (listing.sellerId === buyerId) {
          throw new ForbiddenException('Você não pode agendar avaliação do seu próprio anúncio');
        }

        const inspector = await tx.inspectorProfile.findFirst({
          where: { id: dto.inspectorProfileId, verified: true },
          select: { userId: true, basePriceCents: true },
        });
        if (!inspector) throw new NotFoundException('Avaliador não encontrado');
        if (inspector.userId === buyerId) {
          throw new ForbiddenException('Você não pode agendar uma avaliação consigo mesmo');
        }
        if (inspector.userId === listing.sellerId) {
          throw new ConflictException('Este avaliador não está disponível para este anúncio');
        }
        if (inspector.basePriceCents < this.rules.minInspectionPriceCents) {
          throw new ConflictException('Este avaliador está indisponível no momento');
        }

        // Checagem branda: a garantia é a exclusion constraint, aplicada no
        // aceite. Ignora quem ocupa o horário mas já venceu (expiresAt <= agora).
        const busy = await tx.appointment.findFirst({
          where: {
            inspectorUserId: inspector.userId,
            status: { in: SLOT_OCCUPYING_STATUSES },
            startsAt: { lt: endsAt },
            endsAt: { gt: startsAt },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { id: true },
        });
        if (busy) throw new ConflictException('O avaliador não está disponível nesse horário');

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
        throw new ConflictException(
          'Você já tem um agendamento em andamento para este anúncio com este avaliador',
        );
      }
      throw error;
    }

    const appointment = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: APPOINTMENT_INCLUDE,
    });
    return BuyerAppointmentResponseDto.from(appointment);
  }

  /** 400 se o início não respeitar a antecedência mínima ou o horizonte de 60 dias. */
  private assertSchedulingWindow(now: Date, startsAt: Date): void {
    const minNoticeHours = this.rules.appointmentMinNoticeHours;
    if (startsAt.getTime() < now.getTime() + minNoticeHours * HOUR_MS) {
      throw new BadRequestException(
        minNoticeHours === 0
          ? 'O horário do agendamento precisa estar no futuro'
          : `O agendamento precisa de pelo menos ${minNoticeHours} ${minNoticeHours === 1 ? 'hora' : 'horas'} de antecedência`,
      );
    }
    if (startsAt.getTime() > now.getTime() + MAX_ADVANCE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `O agendamento pode ser feito com no máximo ${MAX_ADVANCE_DAYS} dias de antecedência`,
      );
    }
  }
}
