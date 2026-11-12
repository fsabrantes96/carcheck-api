import type { AppointmentStatus, Prisma } from '../generated/prisma/client.js';
import {
  EXPIRABLE_STATUSES,
  INSPECTOR_RESPONSE_WINDOW_MINUTES,
  PAYMENT_WINDOW_MINUTES,
  SELLER_CONFIRM_WINDOW_MINUTES,
} from './appointments.constants.js';

/** Estados que têm prazo para a próxima etapa. */
export type ExpirableStatus = 'REQUESTED' | 'ACCEPTED' | 'AWAITING_PAYMENT';

const WINDOW_MINUTES: Record<ExpirableStatus, number> = {
  REQUESTED: INSPECTOR_RESPONSE_WINDOW_MINUTES, // avaliador responde
  ACCEPTED: SELLER_CONFIRM_WINDOW_MINUTES, // vendedor confirma
  AWAITING_PAYMENT: PAYMENT_WINDOW_MINUTES, // comprador paga
};

/**
 * Prazo do estado: `min(entrada no estado + janela, startsAt)`. Nunca passa
 * do início da avaliação (desenho, seção 4).
 */
export function deadlineFor(status: ExpirableStatus, enteredAt: Date, startsAt: Date): Date {
  const windowEnd = enteredAt.getTime() + WINDOW_MINUTES[status] * 60_000;
  return new Date(Math.min(windowEnd, startsAt.getTime()));
}

/*
 * Regra única de "vencido" (desenho, seção 4): status com prazo E
 * `expiresAt <= agora`. As ações e o job de expiração usam estas funções;
 * não reescreva a comparação em outro lugar.
 */

/** O agendamento venceu? Mesmo critério de `dueWhere`, para um registro já lido. */
export function isDue(status: AppointmentStatus, expiresAt: Date | null, now: Date): boolean {
  return EXPIRABLE_STATUSES.includes(status) && expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

/**
 * Filtro do Prisma para os vencidos. `status` restringe os estados (um só ou
 * uma lista); o padrão são todos os que têm prazo. Só aceita estados de
 * `EXPIRABLE_STATUSES`: qualquer outro (PAID, posteriores, finais) lança
 * RangeError, para nenhuma chamada expirar dinheiro retido por engano.
 */
export function dueWhere(
  now: Date,
  status: AppointmentStatus | readonly AppointmentStatus[] = EXPIRABLE_STATUSES,
): Prisma.AppointmentWhereInput {
  for (const each of typeof status === 'string' ? [status] : status) {
    if (!EXPIRABLE_STATUSES.includes(each)) throw new RangeError(`dueWhere: o estado ${each} não expira`);
  }
  return {
    status: typeof status === 'string' ? status : { in: [...status] },
    expiresAt: { lte: now },
  };
}

/** Campos gravados ao expirar: estado final, encerrado pelo sistema, agora. */
export function expiredData(now: Date) {
  return { status: 'EXPIRED', endedBy: 'SYSTEM', endedAt: now } satisfies Prisma.AppointmentUpdateManyMutationInput;
}
