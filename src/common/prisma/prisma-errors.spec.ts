import {
  databaseErrorWithPgCode,
  exclusionViolationFromModelQuery,
  exclusionViolationFromRawQuery,
  knownErrorWithMeta,
} from '../../../test/support/prisma-error-fixtures.js';
import { isPgError, PG_EXCLUSION_VIOLATION } from './prisma-errors.js';

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
