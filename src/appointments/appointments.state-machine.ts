import type { AppointmentStatus as Status } from '../generated/prisma/client.js';

/**
 * Máquina de estados do agendamento (docs/appointments-design.md, seção 3).
 * Só funções puras: sem Nest e sem Prisma.
 *
 * "Quem" é o papel do usuário NAQUELE agendamento (BUYER, SELLER, INSPECTOR),
 * não a role global. Transições automáticas usam SYSTEM.
 */
export type Participant = 'BUYER' | 'SELLER' | 'INSPECTOR';
export type Actor = Participant | 'SYSTEM';

export type AppointmentAction =
  | 'ACCEPT'
  | 'DECLINE'
  | 'CONFIRM'
  | 'CANCEL'
  | 'EXPIRE'
  | 'MARK_PAID' // declarado (branch de pagamento)
  | 'SUBMIT_REPORT' // declarado (branch de laudo)
  | 'APPROVE' // declarado (branch de laudo)
  | 'OPEN_DISPUTE' // declarado (branch de disputa)
  | 'AUTO_RELEASE'; // declarado (branch de laudo)

const TRANSITIONS: Record<AppointmentAction, { from: readonly Status[]; to: Status }> = {
  ACCEPT: { from: ['REQUESTED'], to: 'ACCEPTED' },
  DECLINE: { from: ['REQUESTED'], to: 'DECLINED' },
  CONFIRM: { from: ['ACCEPTED'], to: 'AWAITING_PAYMENT' },
  CANCEL: { from: ['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'], to: 'CANCELLED' },
  EXPIRE: { from: ['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'], to: 'EXPIRED' },
  MARK_PAID: { from: ['AWAITING_PAYMENT'], to: 'PAID' },
  SUBMIT_REPORT: { from: ['PAID'], to: 'REPORT_SUBMITTED' },
  APPROVE: { from: ['REPORT_SUBMITTED'], to: 'COMPLETED' },
  OPEN_DISPUTE: { from: ['REPORT_SUBMITTED'], to: 'DISPUTED' },
  AUTO_RELEASE: { from: ['REPORT_SUBMITTED'], to: 'COMPLETED' },
};

const PERMISSIONS: Record<AppointmentAction, readonly Actor[]> = {
  ACCEPT: ['INSPECTOR'],
  DECLINE: ['INSPECTOR'],
  CONFIRM: ['SELLER'],
  CANCEL: ['BUYER', 'SELLER', 'INSPECTOR'],
  EXPIRE: ['SYSTEM'],
  MARK_PAID: ['SYSTEM'],
  SUBMIT_REPORT: ['INSPECTOR'],
  APPROVE: ['BUYER'],
  OPEN_DISPUTE: ['BUYER'],
  AUTO_RELEASE: ['SYSTEM'],
};

/** Ações que têm rota nesta versão da API (o resto só está declarado). */
export const ROUTE_ACTIONS: readonly AppointmentAction[] = ['ACCEPT', 'DECLINE', 'CONFIRM', 'CANCEL'];

export type Decision =
  | { ok: true; to: Status }
  | { ok: false; reason: 'FORBIDDEN_ACTOR' | 'INVALID_STATE' };

/**
 * Decide se `actor` pode executar `action` no status `current`. A permissão
 * do papel é conferida antes do estado: papel sem permissão é 403 em qualquer
 * estado; estado errado é 409.
 */
export function decide(actor: Actor, action: AppointmentAction, current: Status): Decision {
  if (!PERMISSIONS[action].includes(actor)) return { ok: false, reason: 'FORBIDDEN_ACTOR' };
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) return { ok: false, reason: 'INVALID_STATE' };
  return { ok: true, to: rule.to };
}

/** Ações com rota que o participante pode executar agora (para o front mostrar os botões). */
export function availableActions(participant: Participant, current: Status): AppointmentAction[] {
  return ROUTE_ACTIONS.filter((action) => decide(participant, action, current).ok);
}

/** Papel do usuário no agendamento, ou null se ele não participa. */
export function participantOf(
  parties: { buyerId: string; sellerId: string; inspectorUserId: string },
  userId: string,
): Participant | null {
  if (parties.buyerId === userId) return 'BUYER';
  if (parties.sellerId === userId) return 'SELLER';
  if (parties.inspectorUserId === userId) return 'INSPECTOR';
  return null;
}
