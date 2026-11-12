import { Prisma } from '../../src/generated/prisma/client.js';

/**
 * Formatos reais dos erros do Postgres que chegam pelo @prisma/adapter-pg,
 * capturados em 2026-11-11 com Prisma 7.10.1 (Fase 0 do PR de agendamento).
 * Se um upgrade do Prisma ou do adapter mudar esse formato, recapture e
 * atualize aqui (risco 27 do docs/audit.md).
 */

/** 23P01 (exclusion constraint) numa query de model (updateMany), código P2039. */
export function exclusionViolationFromModelQuery(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Invalid `prisma.appointment.updateMany()` invocation:\n\nDatabase error. Code: `23P01`. Message: `conflicting key value violates exclusion constraint "Appointment_inspector_slot_excl"`',
    {
      code: 'P2039',
      clientVersion: '7.10.1',
      meta: {
        modelName: 'Appointment',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23P01',
            originalMessage:
              'conflicting key value violates exclusion constraint "Appointment_inspector_slot_excl"',
            kind: 'postgres',
            code: '23P01',
            severity: 'ERROR',
            message:
              'conflicting key value violates exclusion constraint "Appointment_inspector_slot_excl"',
            detail: 'Key ("inspectorUserId", tstzrange(...))=(...) conflicts with existing key (...).',
          },
        },
      },
    },
  );
}

/** 23P01 via $executeRaw, código P2010. */
export function exclusionViolationFromRawQuery(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Invalid `prisma.$executeRaw()` invocation:\n\nRaw query failed. Code: `23P01`.',
    {
      code: 'P2010',
      clientVersion: '7.10.1',
      meta: {
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23P01',
            originalMessage: 'conflicting key value violates exclusion constraint "x"',
            kind: 'postgres',
            code: '23P01',
            severity: 'ERROR',
            message: 'conflicting key value violates exclusion constraint "x"',
          },
        },
      },
    },
  );
}

/** 23505 de um índice único parcial numa query de model, código P2002. */
export function partialUniqueViolation(indexName: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the constraint: \`${indexName}\``,
    {
      code: 'P2002',
      clientVersion: '7.10.1',
      meta: {
        modelName: 'Appointment',
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: {
            originalCode: '23505',
            originalMessage: `duplicate key value violates unique constraint "${indexName}"`,
            kind: 'UniqueConstraintViolation',
            constraint: { index: indexName },
          },
        },
      },
    },
  );
}

/** Mesmo formato do P2039, mas com outro SQLSTATE (ex.: 23514, violação de CHECK). */
export function databaseErrorWithPgCode(pgCode: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Database error. Code: \`${pgCode}\`.`, {
    code: 'P2039',
    clientVersion: '7.10.1',
    meta: {
      modelName: 'Appointment',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: { originalCode: pgCode, kind: 'postgres', code: pgCode, message: 'erro do banco' },
      },
    },
  });
}

/** Erro conhecido do Prisma com um meta arbitrário (para formatos incompletos). */
export function knownErrorWithMeta(meta: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('erro', {
    code: 'P2039',
    clientVersion: '7.10.1',
    meta: meta as Record<string, unknown>,
  });
}
