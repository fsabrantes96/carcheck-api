import { Prisma } from '../../generated/prisma/client.js';

/** Violação de restrição única (ex.: e-mail ou userId duplicado). */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** Registro exigido pela operação não encontrado (ex.: update sem linha no where). */
export const PRISMA_RECORD_NOT_FOUND = 'P2025';

/** Indica se o erro é um erro conhecido do Prisma com o código informado. */
export function isPrismaError(
  error: unknown,
  code: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

/** SQLSTATE do Postgres para violação de exclusion constraint. */
export const PG_EXCLUSION_VIOLATION = '23P01';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Indica se o erro é do Prisma e veio do Postgres com o SQLSTATE informado.
 * Com o @prisma/adapter-pg o código do Postgres chega em
 * meta.driverAdapterError.cause.originalCode (ou .code), com o código do
 * Prisma genérico (P2039 em query de model, P2010 em raw). Formato conferido
 * em 2026-11-11 no Prisma 7.10.1; rever a cada upgrade (risco 27 do
 * docs/audit.md). Nunca lança: formato incompleto devolve false.
 */
export function isPgError(error: unknown, pgCode: string): boolean {
  return pgCodeOf(error) === pgCode;
}

/** SQLSTATE do Postgres dentro de um erro do Prisma, se houver. Nunca lança. */
function pgCodeOf(error: unknown): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError))
    return undefined;
  const adapterError = asRecord(asRecord(error.meta)?.driverAdapterError);
  const cause = asRecord(adapterError?.cause);
  if (!cause) return undefined;
  return typeof cause.originalCode === 'string'
    ? cause.originalCode
    : cause.code;
}

/** SQLSTATE do Postgres para deadlock entre transações. */
export const PG_DEADLOCK_DETECTED = '40P01';

/** SQLSTATE do Postgres para falha de serialização (isolamento REPEATABLE READ/SERIALIZABLE). */
export const PG_SERIALIZATION_FAILURE = '40001';

/** Código do Prisma para conflito de escrita ou deadlock numa transação. */
export const PRISMA_TRANSACTION_CONFLICT = 'P2034';

const TRANSACTION_CONFLICT_PG_CODES: readonly string[] = [
  PG_DEADLOCK_DETECTED,
  PG_SERIALIZATION_FAILURE,
];

/**
 * Se o erro é um conflito de transação que o Postgres abortou e que pode dar
 * certo se o cliente repetir, devolve o código para o log: o SQLSTATE (40P01
 * ou 40001) quando ele vem no meta, ou 'P2034' quando só o código do Prisma
 * está disponível. Senão, undefined.
 *
 * Com o @prisma/adapter-pg, os dois SQLSTATE chegam com
 * `kind: 'TransactionWriteConflict'`: P2034 em query de model, P2010
 * (genérico) em raw, por isso o raw é reconhecido pelo SQLSTATE. Formato
 * conferido em 2026-11-12 no Prisma 7.10.1 pelo e2e
 * test/prisma-driver-contract.e2e-spec.ts (risco 27 do docs/audit.md).
 */
export function transactionConflictCode(error: unknown): string | undefined {
  const pgCode = pgCodeOf(error);
  if (
    typeof pgCode === 'string' &&
    TRANSACTION_CONFLICT_PG_CODES.includes(pgCode)
  ) {
    return pgCode;
  }
  return isPrismaError(error, PRISMA_TRANSACTION_CONFLICT)
    ? PRISMA_TRANSACTION_CONFLICT
    : undefined;
}

/**
 * Indica se o erro é um P2002 (violação de unicidade) do índice informado.
 * Com o @prisma/adapter-pg o nome chega em
 * meta.driverAdapterError.cause.constraint.index. Nunca lança: formato
 * incompleto devolve false.
 */
export function isUniqueViolationOn(error: unknown, indexName: string): boolean {
  if (!isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) return false;
  const cause = asRecord(asRecord(asRecord(error.meta)?.driverAdapterError)?.cause);
  return asRecord(cause?.constraint)?.index === indexName;
}
