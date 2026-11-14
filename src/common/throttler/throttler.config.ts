import type { ThrottlerModuleOptions } from '@nestjs/throttler';

const ONE_MINUTE_MS = 60_000;

export const THROTTLE_ERROR_MESSAGE =
  'Muitas requisições. Tente novamente em instantes.';

/** Limite global por IP, por minuto (também citado no Swagger). */
export const GLOBAL_THROTTLE_LIMIT = 100;

/** Limite global: 100 requisições por minuto por IP. */
export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [{ name: 'default', ttl: ONE_MINUTE_MS, limit: GLOBAL_THROTTLE_LIMIT }],
  errorMessage: THROTTLE_ERROR_MESSAGE,
};

/**
 * Limite das rotas de login e cadastro: 5 por minuto por IP.
 * Usar com @Throttle(AUTH_THROTTLE).
 */
export const AUTH_THROTTLE = {
  default: { ttl: ONE_MINUTE_MS, limit: 5 },
};

/**
 * Limite da criação de agendamento: 10 por minuto por IP (risco 28).
 * Usar com @Throttle(APPOINTMENT_CREATE_THROTTLE).
 */
export const APPOINTMENT_CREATE_THROTTLE = {
  default: { ttl: ONE_MINUTE_MS, limit: 10 },
};
