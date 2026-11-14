import {
  defaultCodeForStatus,
  ERROR_CODES,
  ErrorCode,
  isErrorCode,
  withCode,
} from './error-code.js';

describe('ErrorCode', () => {
  it('usa SCREAMING_SNAKE_CASE, com cada valor igual ao nome', () => {
    for (const [name, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(name);
      expect(value).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
  });

  it('expõe a lista de codes sem repetição (o enum do Swagger)', () => {
    expect(ERROR_CODES).toEqual(Object.values(ErrorCode));
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it.each([
    'VALIDATION_FAILED',
    'INVALID_ID',
    'INVALID_URL_PARAM',
    'INVALID_BODY',
    'BAD_REQUEST',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'NOT_FOUND',
    'ROUTE_NOT_FOUND',
    'METHOD_NOT_ALLOWED',
    'CONFLICT',
    'TRANSACTION_CONFLICT',
    'PRECONDITION_FAILED',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'RANGE_NOT_SATISFIABLE',
    'TOO_MANY_REQUESTS',
    'INTERNAL_ERROR',
  ])('tem o code genérico %s', (code) => {
    expect(ERROR_CODES).toContain(code);
  });
});

describe('ErrorCode de domínio', () => {
  it.each([
    'INVALID_CREDENTIALS',
    'EMAIL_ALREADY_REGISTERED',
    'USER_NOT_FOUND',
    'LISTING_NOT_FOUND',
    'INSPECTOR_NOT_FOUND',
    'INSPECTOR_PROFILE_NOT_FOUND',
    'APPOINTMENT_NOT_FOUND',
    'INSPECTOR_PROFILE_EXISTS',
    'INVALID_STATE',
    'APPOINTMENT_EXPIRED',
    'STATE_CHANGED',
    'LISTING_HAS_PAID_APPOINTMENT',
    'APPOINTMENT_DUPLICATE',
    'SLOT_UNAVAILABLE',
    'INSPECTOR_UNAVAILABLE',
    'INSPECTOR_NOT_VERIFIED',
    'PRICE_BELOW_MINIMUM',
    'INVALID_SCHEDULE',
  ])('tem o code %s', (code) => {
    expect(ERROR_CODES).toContain(code);
  });
});

describe('defaultCodeForStatus', () => {
  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'METHOD_NOT_ALLOWED'],
    [409, 'CONFLICT'],
    [412, 'PRECONDITION_FAILED'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [416, 'RANGE_NOT_SATISFIABLE'],
    [429, 'TOO_MANY_REQUESTS'],
    [500, 'INTERNAL_ERROR'],
  ])('mapeia o status %i para %s', (status, code) => {
    expect(defaultCodeForStatus(status)).toBe(code);
  });

  it.each([402, 406, 418, 422, 451, 499])(
    'cai em BAD_REQUEST num 4xx fora do mapa (%i)',
    (status) => {
      expect(defaultCodeForStatus(status)).toBe('BAD_REQUEST');
    },
  );

  it.each([501, 502, 503, 504, 599, 200, 302, 0])(
    'cai em INTERNAL_ERROR fora da faixa 4xx (%i)',
    (status) => {
      expect(defaultCodeForStatus(status)).toBe('INTERNAL_ERROR');
    },
  );

  it('devolve sempre um code do enum', () => {
    for (let status = 100; status < 600; status++) {
      expect(ERROR_CODES).toContain(defaultCodeForStatus(status));
    }
  });
});

describe('withCode', () => {
  it('monta o corpo da exceção com code e mensagem', () => {
    expect(withCode(ErrorCode.INVALID_ID, 'Identificador inválido')).toEqual({
      code: 'INVALID_ID',
      message: 'Identificador inválido',
    });
  });
});

describe('isErrorCode', () => {
  it('reconhece um code do enum', () => {
    expect(isErrorCode('ROUTE_NOT_FOUND')).toBe(true);
  });

  it.each([undefined, null, 42, '', 'route_not_found', 'NAO_EXISTE', {}])(
    'recusa %j',
    (value) => {
      expect(isErrorCode(value)).toBe(false);
    },
  );
});
