import { BadRequestException, HttpException } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { isBodyParserError } from './body-parser-error.js';

/**
 * Mensagens, por status, dos erros da camada do Express que o Nest converte
 * em HttpException. Nunca se usa a mensagem do erro: ela vem em inglês e pode
 * repetir a entrada (ex.: "Failed to decode param '%FF'").
 */
const HTTP_LAYER_MESSAGES: Record<number, string> = {
  400: 'Requisição inválida',
  403: 'Acesso negado',
  404: 'Recurso não encontrado',
  405: 'Método não permitido',
  412: 'Pré-condição da requisição não atendida',
  413: 'Corpo da requisição muito grande',
  415: 'Tipo de conteúdo não suportado',
  416: 'Intervalo solicitado inválido',
};
const HTTP_LAYER_DEFAULT_MESSAGE = 'Requisição inválida';
const INVALID_URL_PARAM_MESSAGE = 'Parâmetro inválido na URL';
const INVALID_BODY_MESSAGE = 'Corpo da requisição inválido';

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

function messageFor(error: unknown, status: number): string {
  // URIError com status 400: o router do Express não decodificou um parâmetro.
  if (error instanceof URIError) return INVALID_URL_PARAM_MESSAGE;
  if (status === 400 && isDecompressionError(error))
    return INVALID_BODY_MESSAGE;
  return HTTP_LAYER_MESSAGES[status] ?? HTTP_LAYER_DEFAULT_MESSAGE;
}

/**
 * O mapException só é chamado para erros da camada do Express (middlewares
 * registrados com app.use, parsers, assets estáticos, router); erros do
 * código Nest vão direto aos filtros.
 *
 * - Erros do body-parser reconhecidos (BODY_PARSER_ERROR_TYPES) seguem
 *   intactos ao AllExceptionsFilter, que decide status e mensagem pelo `type`.
 * - O que o ExpressAdapter do Nest (12.5) converte em HttpException
 *   (SyntaxError/URIError com status 400, http-errors < 500) mantém o status,
 *   mas troca a mensagem do erro por uma fixa em pt-BR (HTTP_LAYER_MESSAGES),
 *   com o erro original em `cause`.
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

    const message = messageFor(error, status);
    // Mantém o tipo que o Nest usa no 400 (BadRequestException).
    return status === 400
      ? new BadRequestException(message, { cause: error })
      : new HttpException(message, status, { cause: error });
  }
}
