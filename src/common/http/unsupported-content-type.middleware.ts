import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ErrorCode, withCode } from '../errors/error-code.js';
import { ACCEPTED_BODY_CONTENT_TYPES } from '../limits.js';
import { UNSUPPORTED_MEDIA_TYPE_MESSAGE } from './http-error-messages.js';

/**
 * A requisição tem corpo? Content-Length acima de zero ou Transfer-Encoding.
 * Um POST sem corpo (ex.: /listings/:id/pause) costuma vir com
 * Content-Length: 0, às vezes com Content-Type; esse passa.
 */
function hasBody(req: Request): boolean {
  if (req.headers['transfer-encoding'] !== undefined) return true;
  const length = Number(req.headers['content-length']);
  return Number.isFinite(length) && length > 0;
}

/**
 * Recusa com 415 um corpo cujo Content-Type não está em
 * ACCEPTED_BODY_CONTENT_TYPES (ou que não tem Content-Type). Sem isso, o
 * parser JSON ignorava o corpo e a resposta era um 400 de validação.
 *
 * Fica logo depois do helmet, antes dos parsers e do roteamento: o 415 vem
 * antes da autenticação (sem token e com corpo text/plain, a resposta é 415,
 * não 401). Não responde sozinho: passa o erro adiante, e o AllExceptionsFilter
 * responde no formato global. A comparação é a do req.is (type-is), a mesma
 * dos parsers: ignora parâmetros (charset), maiúsculas e espaços.
 */
export function rejectUnsupportedContentType(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (!hasBody(req) || req.is([...ACCEPTED_BODY_CONTENT_TYPES])) {
    next();
    return;
  }
  next(
    new UnsupportedMediaTypeException(
      withCode(
        ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        UNSUPPORTED_MEDIA_TYPE_MESSAGE,
      ),
    ),
  );
}
