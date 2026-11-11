import type { ListingStatus } from '../generated/prisma/client.js';

/**
 * Ciclo de vida do anúncio (desenho em docs/appointments-design.md, seção 2).
 * Só o dono executa as ações; quem é o dono é conferido no service.
 * ARCHIVED é final.
 */
export type ListingAction = 'PAUSE' | 'ACTIVATE' | 'MARK_SOLD' | 'ARCHIVE';

const TRANSITIONS: Record<
  ListingAction,
  { from: readonly ListingStatus[]; to: ListingStatus }
> = {
  PAUSE: { from: ['ACTIVE'], to: 'PAUSED' },
  ACTIVATE: { from: ['PAUSED'], to: 'ACTIVE' },
  MARK_SOLD: { from: ['ACTIVE', 'PAUSED'], to: 'SOLD' },
  ARCHIVE: { from: ['ACTIVE', 'PAUSED', 'SOLD'], to: 'ARCHIVED' },
};

export type ListingTransition =
  | { ok: true; to: ListingStatus }
  | { ok: false; reason: 'INVALID_STATE' };

/** Decide se a ação é permitida no status atual e para qual status leva. */
export function decideListingTransition(
  action: ListingAction,
  current: ListingStatus,
): ListingTransition {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) return { ok: false, reason: 'INVALID_STATE' };
  return { ok: true, to: rule.to };
}
