import { applyDecorators } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTooManyRequestsResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto.js';
import { THROTTLE_ERROR_MESSAGE } from '../throttler/throttler.config.js';

/**
 * Descrições reaproveitadas nas respostas de erro do Swagger. O texto entre
 * aspas é a mensagem que a API devolve; o resto explica quando acontece.
 */
export const UNAUTHORIZED_DESCRIPTION = 'Token ausente, inválido ou expirado';
export const INVALID_UUID_DESCRIPTION = 'Id inválido: precisa ser uuid';
/** Deadlock ou falha de serialização no banco (AllExceptionsFilter): o cliente repete. */
export const TRANSACTION_CONFLICT_DESCRIPTION =
  'ou "Conflito ao processar, tente novamente" (conflito de transação no banco; repita a requisição)';

/**
 * Erros que qualquer rota pode responder: 429 do limite global do throttler
 * (100/min por IP) e 500 genérico. Use na classe do controller; uma rota com
 * limite próprio declara o seu 429, que prevalece.
 */
export function ApiCommonErrorResponses(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiTooManyRequestsResponse({
      type: ErrorResponseDto,
      description: `${THROTTLE_ERROR_MESSAGE} (limite global de 100 requisições por minuto por IP)`,
    }),
    ApiInternalServerErrorResponse({
      type: ErrorResponseDto,
      description: 'Erro interno do servidor',
    }),
  );
}

/**
 * Erros do body-parser em rotas com corpo: 413 acima de 100kb e 415 com
 * Content-Encoding ou charset não suportado. O 400 (validação ou JSON
 * malformado) fica em cada rota, com a descrição dela.
 */
export function ApiBodyErrorResponses(): MethodDecorator {
  return applyDecorators(
    ApiPayloadTooLargeResponse({
      type: ErrorResponseDto,
      description: 'Corpo da requisição muito grande (acima de 100kb)',
    }),
    ApiUnsupportedMediaTypeResponse({
      type: ErrorResponseDto,
      description: 'Content-Encoding ou charset do corpo não suportado',
    }),
  );
}

/** Parâmetro de rota :id, validado pelo ParseUUIDPipe (400 se não for uuid). */
export function ApiUuidParam(): MethodDecorator {
  return ApiParam({ name: 'id', type: String, format: 'uuid' });
}
