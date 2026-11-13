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
import {
  isPgError,
  PG_EXCLUSION_VIOLATION,
  transactionConflictCode,
} from '../prisma/prisma-errors.js';

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
  'querystring.parse.rangeError': 'Corpo da requisição inválido',
};
const BODY_PARSER_DEFAULT_MESSAGE = 'Requisição inválida';

/**
 * Cabeçalhos que descrevem um arquivo estático. O send (assets do /docs)
 * grava esses cabeçalhos antes de emitir o 412/416; sem removê-los, o JSON de
 * erro sairia como text/css, com o ETag e o Last-Modified do arquivo. O
 * Content-Range fica (o 416 o exige) e o res.json recalcula Content-Type e
 * Content-Length. Vale para todo erro: um Cache-Control definido antes da
 * exceção (ex.: no-store por um interceptor) também sai da resposta de erro.
 */
const FILE_HEADERS = [
  'Content-Type',
  'Content-Length',
  'ETag',
  'Last-Modified',
  'Cache-Control',
  'Accept-Ranges',
];

/**
 * Violação de exclusion constraint (23P01). Hoje a única é a do horário do
 * avaliador no agendamento: duas reservas sobrepostas, ou o estado mudou no
 * meio do caminho.
 */
const EXCLUSION_VIOLATION_MESSAGE =
  'O agendamento mudou ou o horário não está mais disponível';

/** Deadlock (40P01) ou falha de serialização (40001): o cliente pode repetir. */
const TRANSACTION_CONFLICT_MESSAGE = 'Conflito ao processar, tente novamente';

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

    if (!response.headersSent) {
      for (const header of FILE_HEADERS) response.removeHeader(header);
    }
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

    // Vem antes do mapa por código: o código do Prisma (P2039/P2010) é
    // genérico; o que identifica o caso é o SQLSTATE do Postgres.
    if (isPgError(exception, PG_EXCLUSION_VIOLATION)) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: EXCLUSION_VIOLATION_MESSAGE,
      };
    }

    // Deadlock/serialização: o Postgres abortou a transação e repetir pode dar
    // certo, então é 409 (como as outras corridas), não 500. Fica registrado
    // com warn para medir se o risco 50 acontece de verdade.
    const conflictCode = transactionConflictCode(exception);
    if (conflictCode) {
      this.logger.warn(
        `Conflito de transação (${conflictCode}) em ${request.method} ${this.routeOf(request)}`,
      );
      return {
        statusCode: HttpStatus.CONFLICT,
        message: TRANSACTION_CONFLICT_MESSAGE,
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

  /**
   * Rota para log sem dados do usuário: o padrão casado pelo Express
   * (ex.: /appointments/:id/accept), ou a URL sem a query string.
   */
  private routeOf(request: Request): string {
    const pattern = (request.route as { path?: unknown } | undefined)?.path;
    return typeof pattern === 'string' ? pattern : request.url.split('?')[0];
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
