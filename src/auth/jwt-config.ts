export const DEFAULT_JWT_EXPIRES_IN_SECONDS = 3600;

/**
 * Lê JWT_EXPIRES_IN_SECONDS na subida da aplicação. Ausente usa o padrão
 * (3600). Qualquer valor que não seja um inteiro positivo de segundos faz a
 * aplicação falhar ao iniciar, em vez de emitir tokens com validade errada
 * (Number('abc') daria NaN, e Number('') daria 0).
 */
export function parseJwtExpiresInSeconds(value: unknown): number {
  if (value === undefined) return DEFAULT_JWT_EXPIRES_IN_SECONDS;

  const seconds =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

  if (
    typeof seconds !== 'number' ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0
  ) {
    throw new Error(
      `JWT_EXPIRES_IN_SECONDS inválido: ${JSON.stringify(value)}. ` +
        'Use um número inteiro positivo de segundos (ex.: 3600).',
    );
  }

  return seconds;
}
