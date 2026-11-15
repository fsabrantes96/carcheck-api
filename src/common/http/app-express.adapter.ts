import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import {
  defaultCodeForStatus,
  ErrorCode,
  withCode,
} from '../errors/error-code.js';
import type { CodedErrorBody } from '../errors/error-code.js';
import { isBodyParserError } from './body-parser-error.js';
import {
  httpLayerMessage,
  INVALID_BODY_MESSAGE,
  INVALID_URL_PARAM_MESSAGE,
  ROUTE_NOT_FOUND_MESSAGE,
} from './http-error-messages.js';

/**
 * Códigos do erro de descompressão do corpo (Content-Encoding): zlib (gzip,
 * deflate: Z_DATA_ERROR, Z_BUF_ERROR...), brotli (ERR__ERROR_FORMAT_...) e
 * zstd (ZSTD_error_..., Node 23+). O body-parser repassa esse erro num
 * http-error 400 sem `type`, reaproveitando o próprio objeto do zlib.
 */
const DECOMPRESSION_ERROR_CODE = /^(Z_|ERR__ERROR_|ZSTD_error_)/;

function isDecompressionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && DECOMPRESSION_ERROR_CODE.test(code);
}

function bodyFor(error: unknown, status: number): CodedErrorBody {
  // URIError com status 400: o router do Express não decodificou um parâmetro.
  if (error instanceof URIError)
    return withCode(ErrorCode.INVALID_URL_PARAM, INVALID_URL_PARAM_MESSAGE);
  if (status === 400 && isDecompressionError(error))
    return withCode(ErrorCode.INVALID_BODY, INVALID_BODY_MESSAGE);
  return withCode(defaultCodeForStatus(status), httpLayerMessage(status));
}

type SetNotFoundHandlerArgs = Parameters<ExpressAdapter['setNotFoundHandler']>;

/**
 * O mapException só é chamado para erros da camada do Express (middlewares
 * registrados com app.use, parsers, assets estáticos, router); erros do
 * código Nest vão direto aos filtros.
 *
 * - Erros do body-parser reconhecidos (BODY_PARSER_ERROR_TYPES) seguem
 *   intactos ao AllExceptionsFilter, que decide status e mensagem pelo `type`.
 * - O que o ExpressAdapter do Nest (12.5) converte em HttpException
 *   (SyntaxError/URIError com status 400, http-errors < 500) mantém o status,
 *   mas troca a mensagem do erro por uma fixa em pt-BR (HTTP_LAYER_MESSAGES)
 *   e põe o code (o padrão do status, ou INVALID_URL_PARAM/INVALID_BODY),
 *   com o erro original em `cause`.
 * - Uma HttpException (ex.: o 415 do rejectUnsupportedContentType, o 404 de
 *   rota) segue intacta.
 * - O resto (inclusive http-errors 5xx) segue intacto, e o filtro responde
 *   500 genérico com Logger.error.
 */
export class AppExpressAdapter extends ExpressAdapter {
  override mapException(error: unknown): unknown {
    if (isBodyParserError(error)) return error;

    const mapped = super.mapException(error);
    if (!(mapped instanceof HttpException) || mapped === error) return mapped;

    const status = mapped.getStatus();
    // Falha do servidor: segue intacta para o filtro responder 500 genérico e
    // registrar no log (o Nest 12.5 não converte 5xx; isto protege upgrades).
    if (status >= 500) return error;

    const body = bodyFor(error, status);
    // Mantém o tipo que o Nest usa no 400 (BadRequestException).
    return status === 400
      ? new BadRequestException(body, { cause: error })
      : new HttpException(body, status, { cause: error });
  }

  /**
   * Rota inexistente (risco 68). O handler do Nest lança
   * `Cannot ${method} ${url}`, em inglês e repetindo a URL crua. No lugar
   * dele, um middleware passa adiante um 404 com mensagem fixa; o
   * exception handler do Nest (registrado logo depois) o entrega ao
   * AllExceptionsFilter. Os 404 dos services não passam por aqui.
   */
  override setNotFoundHandler(
    _handler: SetNotFoundHandlerArgs[0],
    prefix?: SetNotFoundHandlerArgs[1],
    excludedRoutes?: SetNotFoundHandlerArgs[2],
  ): unknown {
    const routeNotFound = (_req: Request, _res: Response, next: NextFunction) => {
      next(
        new NotFoundException(
          withCode(ErrorCode.ROUTE_NOT_FOUND, ROUTE_NOT_FOUND_MESSAGE),
        ),
      );
    };
    return super.setNotFoundHandler(routeNotFound, prefix, excludedRoutes);
  }
}
