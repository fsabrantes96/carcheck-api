import type { AppointmentStatus } from '../generated/prisma/client.js';

/**
 * Nome do índice único parcial do trio em aberto (comprador, anúncio,
 * avaliador), criado à mão na migration add_appointments. O service
 * reconhece o P2002 por este nome; o e2e do pedido duplicado prova que ele
 * bate com o da migration.
 */
export const APPOINTMENT_OPEN_TRIPLET_INDEX = 'Appointment_open_triplet_key';

/** Estados "em andamento" do índice único parcial do trio (mesma lista da migration). */
export const OPEN_TRIPLET_STATUSES: AppointmentStatus[] = [
  'REQUESTED',
  'ACCEPTED',
  'AWAITING_PAYMENT',
  'PAID',
  'REPORT_SUBMITTED',
  'DISPUTED',
];

/** Horizonte máximo para agendar, em dias. */
export const MAX_ADVANCE_DAYS = 60;

/** Prazos de cada etapa (docs/appointments-design.md, seção 4). */
export const INSPECTOR_RESPONSE_WINDOW_MINUTES = 24 * 60;
export const SELLER_CONFIRM_WINDOW_MINUTES = 24 * 60;
export const PAYMENT_WINDOW_MINUTES = 30;

/**
 * Ocupam o horário do avaliador: ACCEPTED, AWAITING_PAYMENT e PAID (mesmos da
 * exclusion constraint). Destes, os que ocupam horário E podem vencer são os
 * abaixo. PAID ocupa o horário sem prazo:
 * nunca é expirado nem tratado como livre, mesmo com expiresAt preenchido.
 */
export const EXPIRING_SLOT_STATUSES: AppointmentStatus[] = ['ACCEPTED', 'AWAITING_PAYMENT'];

/** Estados com prazo de expiração (expiresAt obrigatório). */
export const EXPIRABLE_STATUSES: AppointmentStatus[] = ['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'];
