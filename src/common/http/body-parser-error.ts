/**
 * Tipos de erro (campo `type`) que o body-parser do Express e o raw-body
 * anexam aos erros que lançam. Servem para distinguir um erro do parser de
 * qualquer outro erro que por acaso tenha um campo `status`.
 */
const BODY_PARSER_ERROR_TYPES = new Set([
  'entity.too.large',
  'entity.parse.failed',
  'entity.verify.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'parameters.too.many',
  // urlencoded com `extended: true` acima de 32 níveis (strictDepth do qs).
  'querystring.parse.rangeError',
  'request.aborted',
  'request.size.invalid',
  'stream.encoding.set',
  'stream.not.readable',
]);

export type BodyParserError = Error & { type: string; status: number };

export function isBodyParserError(error: unknown): error is BodyParserError {
  if (!(error instanceof Error)) return false;
  const { type, status } = error as Partial<BodyParserError>;
  return (
    typeof type === 'string' &&
    BODY_PARSER_ERROR_TYPES.has(type) &&
    typeof status === 'number'
  );
}
