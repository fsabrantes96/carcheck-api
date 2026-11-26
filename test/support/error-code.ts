import { HttpException } from '@nestjs/common';

/**
 * Code da HttpException com que a promise rejeita (o `code` do corpo da
 * exceção, posto com withCode), ou undefined se não houver.
 */
export async function rejectionCode(
  promise: Promise<unknown>,
): Promise<unknown> {
  const error = await promise.then(
    () => {
      throw new Error('a promise não rejeitou');
    },
    (e: unknown) => e,
  );
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  return typeof body === 'object' && body !== null
    ? (body as { code?: unknown }).code
    : undefined;
}
