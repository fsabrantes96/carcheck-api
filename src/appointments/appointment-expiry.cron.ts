import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CLOCK } from '../common/clock/clock.js';
import type { Clock } from '../common/clock/clock.js';
import { AppointmentExpiryService } from './appointment-expiry.service.js';

/** Nome do cron no SchedulerRegistry. */
export const APPOINTMENT_EXPIRY_CRON = 'appointments.expire-due';

/**
 * Agenda a expiração a cada minuto. Só chama o serviço com a hora do CLOCK;
 * a regra está no AppointmentExpiryService.
 *
 * Cada instância da API roda o próprio cron. É seguro porque o updateMany é
 * condicional e idempotente (desenho, seção 4).
 */
@Injectable()
export class AppointmentExpiryCron {
  private readonly logger = new Logger(AppointmentExpiryCron.name);
  /** Execução em andamento nesta instância: a próxima é pulada. */
  private running = false;

  constructor(
    private readonly expiry: AppointmentExpiryService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: APPOINTMENT_EXPIRY_CRON })
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.expiry.expireDue(this.clock.now());
      if (count > 0) this.logger.log(`${count} agendamento(s) expirado(s)`);
    } catch (error) {
      // Nunca derruba a aplicação: registra e tenta de novo no próximo minuto.
      this.logger.error(
        'Falha ao expirar agendamentos vencidos',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
