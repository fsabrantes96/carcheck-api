import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import type { ErrorResponseDto } from '../dto/error-response.dto.js';
import { isBodyParserError } from '../http/body-parser-error.js';

/** Erros conhecidos do Prisma que viram respostas HTTP previsíveis. */
const PRISMA_ERROR_MAP: Record<
  string,
  { status: HttpStatus; message: string }
> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'Registro já existe' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Registro não encontrado' },
  P2003: {
    status: HttpStatus.CONFLICT,
    message: 'Operação viola uma relação com outro registro',
  },
};

/** Mensagens dos erros 4xx do body-parser, no lugar das mensagens internas. */
const BODY_PARSER_MESSAGES: Record<string, string> = {
  'entity.too.large': 'Corpo da requisição muito grande',
  'entity.parse.failed': 'Corpo da requisição inválido',
};
const BODY_PARSER_DEFAULT_MESSAGE = 'Requisição inválida';

const INTERNAL_ERROR_MESSAGE = 'Erro interno do servidor';
const VALIDATION_MESSAGE = 'Dados inválidos';

type ErrorBody = Pick<ErrorResponseDto, 'statusCode' | 'message' | 'errors'>;

/**
 * Filtro global: toda exceção sai no formato de ErrorResponseDto.
 * Nunca devolve stack, SQL, meta ou nomes de coluna ao cliente.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const body = this.toBody(exception, request);

    const payload: ErrorResponseDto = {
      statusCode: body.statusCode,
      error: this.statusName(body.statusCode),
      message: body.message,
      ...(body.errors && { errors: body.errors }),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(body.statusCode).json(payload);
  }

  private toBody(exception: unknown, request: Request): ErrorBody {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // Só 4xx do parser são repassados; 5xx do parser caem no 500 genérico.
    if (
      isBodyParserError(exception) &&
      exception.status >= 400 &&
      exception.status <= 499
    ) {
      return {
        statusCode: exception.status,
        message:
          BODY_PARSER_MESSAGES[exception.type] ?? BODY_PARSER_DEFAULT_MESSAGE,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_ERROR_MAP[exception.code];
      if (mapped) {
        return { statusCode: mapped.status, message: mapped.message };
      }
    }

    this.logger.error(
      `Erro não tratado em ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: INTERNAL_ERROR_MESSAGE,
    };
  }

  private fromHttpException(exception: HttpException): ErrorBody {
    const statusCode = exception.getStatus();
    const res = exception.getResponse();

    const rawMessage =
      typeof res === 'string'
        ? res
        : ((res as { message?: unknown }).message ?? exception.message);

    // O ValidationPipe devolve a lista de problemas em "message".
    if (Array.isArray(rawMessage)) {
      return {
        statusCode,
        message: VALIDATION_MESSAGE,
        errors: rawMessage.map(String),
      };
    }

    return {
      statusCode,
      message: typeof rawMessage === 'string' ? rawMessage : exception.message,
    };
  }

  private statusName(statusCode: number): string {
    const name = HttpStatus[statusCode] as string | undefined;
    if (!name) return 'Error';
    // NOT_FOUND -> Not Found
    return name
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
