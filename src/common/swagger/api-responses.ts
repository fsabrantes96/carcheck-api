import { applyDecorators } from '@nestjs/common';
import {
  ApiInternalServerErrorResponse,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTooManyRequestsResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto.js';
import { BODY_SIZE_LIMIT } from '../limits.js';
import {
  GLOBAL_THROTTLE_LIMIT,
  THROTTLE_ERROR_MESSAGE,
} from '../throttler/throttler.config.js';

/**
 * Descrições reaproveitadas nas respostas de erro do Swagger. Os números vêm
 * das constantes da configuração: se o limite mudar, a documentação muda junto.
 */
export const UNAUTHORIZED_DESCRIPTION = 'Token ausente, inválido ou expirado';
/** Rotas com RolesGuard: ele também responde 401 se a conta do token não existe mais. */
export const UNAUTHORIZED_OR_DELETED_ACCOUNT_DESCRIPTION =
  'Token ausente, inválido ou expirado, ou token válido de uma conta que não existe mais';
export const INVALID_UUID_DESCRIPTION = 'Id inválido: precisa ser uuid';
/**
 * Deadlock ou falha de serialização no banco (AllExceptionsFilter): o cliente
 * repete. Só nas rotas que abrem transação ($transaction).
 */
export const TRANSACTION_CONFLICT_DESCRIPTION =
  'ou "Conflito ao processar, tente novamente" (conflito de transação no banco; repita a requisição)';

/** Descrição do 429 de um limite por IP, por minuto. */
export function throttleDescription(limit: number): string {
  return `${THROTTLE_ERROR_MESSAGE} Limite: ${limit} requisições por minuto por IP.`;
}

/**
 * Erros que qualquer rota pode responder: 429 do limite global do throttler
 * e 500 genérico. Use na classe do controller; uma rota com limite próprio
 * declara o seu 429, que prevalece.
 */
export function ApiCommonErrorResponses(): ClassDecorator & MethodDecorator {
  return applyDecorators(
    ApiTooManyRequestsResponse({
      type: ErrorResponseDto,
      description: throttleDescription(GLOBAL_THROTTLE_LIMIT),
    }),
    ApiInternalServerErrorResponse({
      type: ErrorResponseDto,
      description: 'Erro interno do servidor',
    }),
  );
}

/**
 * Erros do body-parser em rotas com corpo: 413 acima do limite do corpo e 415
 * com Content-Encoding ou charset não suportado. O 400 (validação ou JSON
 * malformado) fica em cada rota, com a descrição dela.
 */
export function ApiBodyErrorResponses(): MethodDecorator {
  return applyDecorators(
    ApiPayloadTooLargeResponse({
      type: ErrorResponseDto,
      description: `Corpo da requisição muito grande (acima de ${BODY_SIZE_LIMIT})`,
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
