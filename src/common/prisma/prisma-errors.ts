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
