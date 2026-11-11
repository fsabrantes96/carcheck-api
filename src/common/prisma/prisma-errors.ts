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
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const adapterError = asRecord(asRecord(error.meta)?.driverAdapterError);
  const cause = asRecord(adapterError?.cause);
  if (!cause) return false;
  const code = typeof cause.originalCode === 'string' ? cause.originalCode : cause.code;
  return code === pgCode;
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
