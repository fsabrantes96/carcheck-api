import {
  databaseErrorWithPgCode,
  deadlockFromRawQuery,
  exclusionViolationFromModelQuery,
  exclusionViolationFromRawQuery,
  knownErrorWithMeta,
  partialUniqueViolation,
  transactionConflictFromModelQuery,
} from '../../../test/support/prisma-error-fixtures.js';
import {
  isPgError,
  isUniqueViolationOn,
  PG_EXCLUSION_VIOLATION,
  transactionConflictCode,
} from './prisma-errors.js';

describe('isPgError', () => {
  it('reconhece o 23P01 de uma query de model (formato real, P2039)', () => {
    expect(isPgError(exclusionViolationFromModelQuery(), PG_EXCLUSION_VIOLATION)).toBe(true);
  });

  it('reconhece o 23P01 de um $executeRaw (formato real, P2010)', () => {
    expect(isPgError(exclusionViolationFromRawQuery(), '23P01')).toBe(true);
  });

  it('devolve false para outro SQLSTATE', () => {
    expect(isPgError(databaseErrorWithPgCode('23514'), '23P01')).toBe(false);
  });

  it('usa cause.code quando originalCode não existe', () => {
    const error = knownErrorWithMeta({ driverAdapterError: { cause: { code: '23P01' } } });

    expect(isPgError(error, '23P01')).toBe(true);
  });

  it.each([
    ['sem meta', undefined],
    ['meta vazio', {}],
    ['meta sem driverAdapterError', { modelName: 'Appointment' }],
    ['driverAdapterError nulo', { driverAdapterError: null }],
    ['driverAdapterError sem cause', { driverAdapterError: { name: 'DriverAdapterError' } }],
    ['cause nulo', { driverAdapterError: { cause: null } }],
    ['cause que não é objeto', { driverAdapterError: { cause: '23P01' } }],
    ['originalCode que não é string', { driverAdapterError: { cause: { originalCode: 23 } } }],
  ])('devolve false, sem lançar, com formato incompleto: %s', (_label, meta) => {
    expect(isPgError(knownErrorWithMeta(meta), '23P01')).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['string', '23P01'],
    ['Error comum', new Error('23P01')],
    [
      'objeto com o mesmo formato, mas que não é erro do Prisma',
      { code: 'P2039', meta: { driverAdapterError: { cause: { originalCode: '23P01' } } } },
    ],
  ])('devolve false para o que não é erro conhecido do Prisma: %s', (_label, value) => {
    expect(isPgError(value, '23P01')).toBe(false);
  });
});

describe('isUniqueViolationOn', () => {
  it('reconhece o P2002 do índice pelo nome (formato real)', () => {
    const error = partialUniqueViolation('Appointment_open_triplet_key');

    expect(isUniqueViolationOn(error, 'Appointment_open_triplet_key')).toBe(true);
  });

  it('devolve false para o P2002 de outro índice', () => {
    const error = partialUniqueViolation('User_email_key');

    expect(isUniqueViolationOn(error, 'Appointment_open_triplet_key')).toBe(false);
  });

  it.each([
    ['sem meta', undefined],
    ['sem driverAdapterError', {}],
    ['sem cause', { driverAdapterError: {} }],
    ['sem constraint', { driverAdapterError: { cause: {} } }],
    ['constraint nula', { driverAdapterError: { cause: { constraint: null } } }],
  ])('devolve false, sem lançar, com formato incompleto: %s', (_label, meta) => {
    const error = partialUniqueViolation('x');
    error.meta = meta as Record<string, unknown> | undefined;

    expect(isUniqueViolationOn(error, 'x')).toBe(false);
  });

  it('devolve false para erro que não é P2002', () => {
    expect(isUniqueViolationOn(exclusionViolationFromModelQuery(), 'Appointment_open_triplet_key')).toBe(false);
  });
});

describe('transactionConflictCode', () => {
  it('devolve 40P01 para o deadlock de uma query de model (formato real, P2034)', () => {
    expect(
      transactionConflictCode(transactionConflictFromModelQuery('40P01')),
    ).toBe('40P01');
  });

  it('devolve 40001 para a falha de serialização (mesmo kind no adapter-pg, P2034)', () => {
    expect(
      transactionConflictCode(transactionConflictFromModelQuery('40001')),
    ).toBe('40001');
  });

  it('devolve 40P01 para o deadlock de um $executeRaw (formato real, P2010)', () => {
    expect(transactionConflictCode(deadlockFromRawQuery())).toBe('40P01');
  });

  it.each(['40P01', '40001'])(
    'reconhece %s em cause.code quando originalCode não existe',
    (pgCode) => {
      const error = knownErrorWithMeta({
        driverAdapterError: { cause: { code: pgCode } },
      });

      expect(transactionConflictCode(error)).toBe(pgCode);
    },
  );

  it('devolve P2034 para um P2034 sem o SQLSTATE no meta', () => {
    const error = transactionConflictFromModelQuery();
    error.meta = undefined;

    expect(transactionConflictCode(error)).toBe('P2034');
  });

  it.each([
    ['23P01 (exclusion constraint)', exclusionViolationFromModelQuery()],
    ['23514 (CHECK)', databaseErrorWithPgCode('23514')],
    ['P2002 (unicidade)', partialUniqueViolation('x')],
    ['P2039 sem SQLSTATE', knownErrorWithMeta({})],
    ['Error comum', new Error('deadlock detected')],
    ['objeto parecido que não é erro do Prisma', { code: 'P2034' }],
    ['null', null],
  ])(
    'devolve undefined para o que não é conflito de transação: %s',
    (_label, value) => {
      expect(transactionConflictCode(value)).toBeUndefined();
    },
  );
});
