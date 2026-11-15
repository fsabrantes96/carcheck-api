import { ErrorCode, withCode } from '../errors/error-code.js';
import type { CodedErrorBody } from '../errors/error-code.js';

/**
 * Mensagens das respostas de erro que não nascem num service: camada do
 * Express (router, body-parser, assets), pipes e filtro global. Ficam todas
 * aqui para o AllExceptionsFilter, o AppExpressAdapter e os pipes usarem o
 * mesmo texto. Nunca se repassa a mensagem do erro original: ela vem em
 * inglês e pode repetir a entrada (URL, parâmetro, corpo).
 */

export const BAD_REQUEST_MESSAGE = 'Requisição inválida';
export const INVALID_URL_PARAM_MESSAGE = 'Parâmetro inválido na URL';
export const INVALID_BODY_MESSAGE = 'Corpo da requisição inválido';
export const INVALID_ID_MESSAGE = 'Identificador inválido';
export const VALIDATION_MESSAGE = 'Dados inválidos';
export const ROUTE_NOT_FOUND_MESSAGE = 'Rota não encontrada';
export const PAYLOAD_TOO_LARGE_MESSAGE = 'Corpo da requisição muito grande';
/** Content-Type fora da lista aceita, Content-Encoding ou charset não suportado. */
export const UNSUPPORTED_MEDIA_TYPE_MESSAGE = 'Formato da requisição não suportado';
export const INTERNAL_ERROR_MESSAGE = 'Erro interno do servidor';

/**
 * Mensagens, por status, dos erros da camada do Express que o Nest converte
 * em HttpException (AppExpressAdapter) e dos 4xx do body-parser sem mensagem
 * própria (AllExceptionsFilter). Status fora do mapa: BAD_REQUEST_MESSAGE.
 */
export const HTTP_LAYER_MESSAGES: Readonly<Record<number, string>> = {
  400: BAD_REQUEST_MESSAGE,
  403: 'Acesso negado',
  404: 'Recurso não encontrado',
  412: 'Pré-condição da requisição não atendida',
  413: PAYLOAD_TOO_LARGE_MESSAGE,
  415: UNSUPPORTED_MEDIA_TYPE_MESSAGE,
  416: 'Intervalo solicitado inválido',
};

export function httpLayerMessage(status: number): string {
  return HTTP_LAYER_MESSAGES[status] ?? BAD_REQUEST_MESSAGE;
}

const PAYLOAD_TOO_LARGE = withCode(ErrorCode.PAYLOAD_TOO_LARGE, PAYLOAD_TOO_LARGE_MESSAGE);
const INVALID_BODY = withCode(ErrorCode.INVALID_BODY, INVALID_BODY_MESSAGE);
const UNSUPPORTED_MEDIA_TYPE = withCode(
  ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  UNSUPPORTED_MEDIA_TYPE_MESSAGE,
);

/**
 * Code e mensagem dos 4xx do body-parser, pelo campo `type` do erro. Tipo
 * fora do mapa: code padrão e mensagem da camada HTTP do status.
 */
export const BODY_PARSER_ERRORS: Readonly<Record<string, CodedErrorBody>> = {
  'entity.too.large': PAYLOAD_TOO_LARGE,
  'parameters.too.many': PAYLOAD_TOO_LARGE,
  'entity.parse.failed': INVALID_BODY,
  'querystring.parse.rangeError': INVALID_BODY,
  'encoding.unsupported': UNSUPPORTED_MEDIA_TYPE,
  'charset.unsupported': UNSUPPORTED_MEDIA_TYPE,
};
