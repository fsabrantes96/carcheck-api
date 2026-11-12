import {
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
