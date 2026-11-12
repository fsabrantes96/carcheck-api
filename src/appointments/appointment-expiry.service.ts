import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { dueWhere, expiredData } from './appointment-deadlines.js';

/**
 * Expira os agendamentos vencidos (EXPIRE do SYSTEM, desenho seção 4). É a
 * regra; quem agenda a execução é o AppointmentExpiryCron.
 */
@Injectable()
export class AppointmentExpiryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Um único updateMany com a condição completa no where (estado expirável E
   * `expiresAt <= now`), sem ler antes: se alguém agir no mesmo instante, só
   * uma das gravações vence, e um estado que já mudou nunca é sobrescrito.
   * Idempotente: rodar de novo com o mesmo `now` devolve 0.
   *
   * @returns quantos agendamentos foram expirados
   */
  async expireDue(now: Date): Promise<number> {
    const { count } = await this.prisma.appointment.updateMany({
      where: dueWhere(now),
      data: expiredData(now),
    });
    return count;
  }
}
