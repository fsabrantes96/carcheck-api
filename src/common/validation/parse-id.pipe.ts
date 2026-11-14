import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { ErrorCode, withCode } from '../errors/error-code.js';
import { INVALID_ID_MESSAGE } from '../http/http-error-messages.js';

/**
 * Pipe dos parâmetros de rota `:id` (uuid), com a mensagem em pt-BR no lugar
 * da padrão do Nest ("Validation failed (uuid is expected)"). Use com
 * `@Param('id', parseIdPipe)` e `@ApiUuidParam()` (que documenta o
 * `format: uuid` no Swagger).
 */
export const parseIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    new BadRequestException(withCode(ErrorCode.INVALID_ID, INVALID_ID_MESSAGE)),
});
