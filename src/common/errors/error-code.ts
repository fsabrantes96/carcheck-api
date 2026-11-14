/**
 * Código legível por máquina de toda resposta de erro (campo `code` do
 * ErrorResponseDto, enum `ErrorCode` no OpenAPI). O front decide pelo code,
 * nunca pelo texto em pt-BR, que pode mudar.
 *
 * Como criar um code novo: acrescente aqui (SCREAMING_SNAKE_CASE, valor igual
 * ao nome), use no throw com `withCode` e rode `npm run openapi`. Um code é
 * contrato: renomear ou remover quebra o front.
 */
export const ErrorCode = {
  // Genéricos: nascem no filtro, no adapter, nos pipes e nos guards.
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_ID: 'INVALID_ID',
  INVALID_URL_PARAM: 'INVALID_URL_PARAM',
  INVALID_BODY: 'INVALID_BODY',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  CONFLICT: 'CONFLICT',
  TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
  PRECONDITION_FAILED: 'PRECONDITION_FAILED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  RANGE_NOT_SATISFIABLE: 'RANGE_NOT_SATISFIABLE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Valores do enum, na ordem da declaração (enum do Swagger). */
export const ERROR_CODES: readonly ErrorCode[] = Object.values(ErrorCode);

const CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/** Corpo de uma HttpException com code: `new ConflictException(withCode(...))`. */
export interface CodedErrorBody {
  code: ErrorCode;
  message: string;
}

/**
 * Corpo da exceção com code e mensagem. O Nest copia a mensagem para
 * `exception.message`, e o AllExceptionsFilter lê o code.
 */
export function withCode(code: ErrorCode, message: string): CodedErrorBody {
  return { code, message };
}

/** Code de uma HttpException lançada sem code, pelo status. */
const DEFAULT_CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  405: ErrorCode.METHOD_NOT_ALLOWED,
  409: ErrorCode.CONFLICT,
  412: ErrorCode.PRECONDITION_FAILED,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  416: ErrorCode.RANGE_NOT_SATISFIABLE,
  429: ErrorCode.TOO_MANY_REQUESTS,
};

/** Status fora do mapa: BAD_REQUEST se for 4xx, INTERNAL_ERROR nos demais. */
export function defaultCodeForStatus(status: number): ErrorCode {
  const mapped = DEFAULT_CODE_BY_STATUS[status];
  if (mapped) return mapped;
  return status >= 400 && status <= 499
    ? ErrorCode.BAD_REQUEST
    : ErrorCode.INTERNAL_ERROR;
}
