import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '../../generated/prisma/client.js';
import {
  databaseErrorWithPgCode,
  deadlockFromRawQuery,
  exclusionViolationFromModelQuery,
  exclusionViolationFromRawQuery,
  transactionConflictFromModelQuery,
} from '../../../test/support/prisma-error-fixtures.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function prismaError(code: string, message = 'erro do prisma', meta = {}) {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: 'test',
    meta,
  });
}

/** Imita o erro do body-parser do Express (http-errors com status e type). */
function bodyParserError(
  type: string,
  status: number,
  message: string,
  base: Error = new Error(message),
) {
  return Object.assign(base, {
    type,
    status,
    statusCode: status,
    expose: status < 500,
  });
}

function createHost(
  url = '/listings/123',
  method = 'GET',
  headersSent = false,
) {
  const request = { url, method };
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    removeHeader: vi.fn(),
    headersSent,
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function run(exception: unknown, url?: string) {
  const { host, response } = createHost(url);
  new AllExceptionsFilter().catch(exception, host);
  const body = response.json.mock.calls[0][0] as Record<string, unknown>;
  return { response, body };
}

describe('AllExceptionsFilter', () => {
  let loggerError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('erros conhecidos do Prisma', () => {
    it.each([
      ['P2002', HttpStatus.CONFLICT, 'Conflict', 'Registro já existe'],
      ['P2025', HttpStatus.NOT_FOUND, 'Not Found', 'Registro não encontrado'],
      [
        'P2003',
        HttpStatus.CONFLICT,
        'Conflict',
        'Operação viola uma relação com outro registro',
      ],
    ])(
      'traduz %s em %i com a mensagem amigável',
      (code, status, error, message) => {
        const { response, body } = run(prismaError(code));

        expect(response.status).toHaveBeenCalledWith(status);
        expect(body.statusCode).toBe(status);
        expect(body.error).toBe(error);
        expect(body.message).toBe(message);
      },
    );

    it('não vaza meta, target, nome de coluna nem a mensagem original', () => {
      const exception = prismaError(
        'P2002',
        'Unique constraint failed: INSERT INTO "User" ("email_secreto") VALUES ($1)',
        { target: ['email_secreto'], modelName: 'User' },
      );

      const { body } = run(exception);
      const serialized = JSON.stringify(body);

      expect(serialized).not.toContain('email_secreto');
      expect(serialized).not.toContain('INSERT INTO');
      expect(serialized).not.toContain('Unique constraint failed');
      expect(serialized).not.toContain('target');
      expect(serialized).not.toContain('meta');
    });

    it('responde 500 genérico para código do Prisma não mapeado', () => {
      const { response, body } = run(
        prismaError('P2000', 'valor muito longo para a coluna "nome"'),
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(body.message).toBe('Erro interno do servidor');
      expect(JSON.stringify(body)).not.toContain('nome');
    });
  });

  describe('violação de exclusion constraint (23P01)', () => {
    it('responde 409 com a mensagem do agendamento quando vem de uma query de model (P2039)', () => {
      const { response, body } = run(exclusionViolationFromModelQuery());

      expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(body).toMatchObject({
        statusCode: 409,
        error: 'Conflict',
        message: 'O agendamento mudou ou o horário não está mais disponível',
      });
    });

    it('responde 409 também quando vem de um $executeRaw (P2010)', () => {
      const { response } = run(exclusionViolationFromRawQuery());

      expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    });

    it('não vaza o nome da constraint, o detail nem o meta', () => {
      const { body } = run(exclusionViolationFromModelQuery());
      const serialized = JSON.stringify(body);

      expect(serialized).not.toContain('Appointment_inspector_slot_excl');
      expect(serialized).not.toContain('inspectorUserId');
      expect(serialized).not.toContain('meta');
    });

    it('não registra no Logger.error (é um conflito esperado)', () => {
      run(exclusionViolationFromModelQuery());

      expect(loggerError).not.toHaveBeenCalled();
    });

    it('mantém 500 e registra no Logger um erro do banco com outro SQLSTATE no mesmo formato (ex.: 23514, CHECK)', () => {
      const { response, body } = run(databaseErrorWithPgCode('23514'));

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(body.message).toBe('Erro interno do servidor');
      expect(loggerError).toHaveBeenCalledTimes(1);
    });
  });

  describe('conflito de transação: deadlock (40P01) e serialização (40001)', () => {
    let loggerWarn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      loggerWarn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });

    /** Como o Express entrega a requisição depois de casar a rota do controller. */
    function runOnRoute(
      exception: unknown,
      url: string,
      method: string,
      routePath?: string,
    ) {
      const request = {
        url,
        method,
        ...(routePath && { route: { path: routePath } }),
      };
      const response = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        removeHeader: vi.fn(),
        headersSent: false,
      };
      const host = {
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
        }),
      } as unknown as ArgumentsHost;
      new AllExceptionsFilter().catch(exception, host);
      const body = response.json.mock.calls[0][0] as Record<string, unknown>;
      return { response, body };
    }

    const ACCEPT_URL =
      '/appointments/0b9f6a52-3f43-4d0e-9c55-6a1f7a0e2b11/accept';
    const ACCEPT_ROUTE = '/appointments/:id/accept';

    it.each([
      [
        'deadlock numa query de model (P2034 + 40P01)',
        transactionConflictFromModelQuery('40P01'),
      ],
      [
        'falha de serialização (P2034 + 40001)',
        transactionConflictFromModelQuery('40001'),
      ],
      ['deadlock num $executeRaw (P2010 + 40P01)', deadlockFromRawQuery()],
      ['P2034 sem o SQLSTATE no meta', prismaError('P2034')],
    ])(
      'responde 409 "Conflito ao processar, tente novamente": %s',
      (_caso, exception) => {
        const { response, body } = runOnRoute(
          exception,
          ACCEPT_URL,
          'POST',
          ACCEPT_ROUTE,
        );

        expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
        expect(body).toMatchObject({
          statusCode: 409,
          error: 'Conflict',
          message: 'Conflito ao processar, tente novamente',
          path: ACCEPT_URL,
        });
        expect(Object.keys(body).sort()).toEqual(
          ['error', 'message', 'path', 'statusCode', 'timestamp'].sort(),
        );
      },
    );

    it.each([
      ['40P01', transactionConflictFromModelQuery('40P01')],
      ['40001', transactionConflictFromModelQuery('40001')],
      ['P2034', prismaError('P2034')],
    ])(
      'registra no Logger.warn o código %s e a rota, e não chama o Logger.error',
      (code, exception) => {
        runOnRoute(exception, ACCEPT_URL, 'POST', ACCEPT_ROUTE);

        expect(loggerWarn).toHaveBeenCalledTimes(1);
        expect(loggerWarn).toHaveBeenCalledWith(
          `Conflito de transação (${code}) em POST ${ACCEPT_ROUTE}`,
        );
        expect(loggerError).not.toHaveBeenCalled();
      },
    );

    it('o log usa o padrão da rota, sem ids, query string nem detalhes do erro', () => {
      runOnRoute(
        transactionConflictFromModelQuery(),
        `${ACCEPT_URL}?email=maria@x.com`,
        'POST',
        ACCEPT_ROUTE,
      );

      expect(loggerWarn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(loggerWarn.mock.calls);
      expect(logged).not.toContain('0b9f6a52');
      expect(logged).not.toContain('maria@x.com');
      expect(logged).not.toContain('deadlock detected');
      expect(logged).not.toContain('Appointment');
    });

    it('sem rota casada, registra a URL sem a query string', () => {
      runOnRoute(
        transactionConflictFromModelQuery(),
        '/qualquer/coisa?email=maria@x.com',
        'GET',
      );

      expect(loggerWarn).toHaveBeenCalledWith(
        'Conflito de transação (40P01) em GET /qualquer/coisa',
      );
    });

    it('não vaza o SQLSTATE, a mensagem do banco nem o meta na resposta', () => {
      const { body } = runOnRoute(
        transactionConflictFromModelQuery(),
        ACCEPT_URL,
        'POST',
        ACCEPT_ROUTE,
      );
      const serialized = JSON.stringify(body);

      expect(serialized).not.toContain('40P01');
      expect(serialized).not.toContain('deadlock');
      expect(serialized).not.toContain('P2034');
      expect(serialized).not.toContain('meta');
    });
  });

  describe('formato da resposta', () => {
    it('tem exatamente as chaves statusCode, error, message, path e timestamp', () => {
      const { body } = run(new NotFoundException('Anúncio não encontrado'));

      expect(Object.keys(body).sort()).toEqual(
        ['error', 'message', 'path', 'statusCode', 'timestamp'].sort(),
      );
    });

    it('usa request.url como path', () => {
      const { body } = run(new NotFoundException(), '/inspectors/me?x=1');

      expect(body.path).toBe('/inspectors/me?x=1');
    });

    it('devolve timestamp em formato ISO', () => {
      const { body } = run(new NotFoundException());

      expect(typeof body.timestamp).toBe('string');
      expect(new Date(body.timestamp as string).toISOString()).toBe(
        body.timestamp,
      );
    });

    it.each([
      ['HttpException', new NotFoundException('Anúncio não encontrado')],
      [
        'lista do ValidationPipe',
        new BadRequestException({ message: ['a', 'b'] }),
      ],
      ['erro do Prisma', prismaError('P2002')],
      ['erro genérico', new Error('falhou')],
      ['valor que não é Error', 'string lançada'],
    ])('message é sempre string (%s)', (_caso, exception) => {
      const { body } = run(exception);

      expect(typeof body.message).toBe('string');
    });
  });

  describe('HttpException', () => {
    it('preserva status e mensagem', () => {
      const { response, body } = run(
        new NotFoundException('Anúncio não encontrado'),
      );

      expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(body.statusCode).toBe(404);
      expect(body.error).toBe('Not Found');
      expect(body.message).toBe('Anúncio não encontrado');
    });

    it('não chama o Logger.error', () => {
      run(new NotFoundException('Anúncio não encontrado'));

      expect(loggerError).not.toHaveBeenCalled();
    });
  });

  describe('ThrottlerException (rate limit)', () => {
    it('sai como 429 Too Many Requests com a mensagem informada', () => {
      const { response, body } = run(
        new ThrottlerException(
          'Muitas requisições. Tente novamente em instantes.',
        ),
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(body.statusCode).toBe(429);
      expect(body.error).toBe('Too Many Requests');
      expect(body.message).toBe(
        'Muitas requisições. Tente novamente em instantes.',
      );
    });

    it('não registra no Logger.error', () => {
      run(new ThrottlerException('Muitas requisições.'));

      expect(loggerError).not.toHaveBeenCalled();
    });
  });

  describe('erros de validação', () => {
    it('troca a lista do ValidationPipe por "Dados inválidos" e devolve errors', () => {
      const { response, body } = run(
        new BadRequestException({
          message: ['a', 'b'],
          error: 'Bad Request',
          statusCode: 400,
        }),
      );

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toBe('Dados inválidos');
      expect(body.errors).toEqual(['a', 'b']);
    });

    it.each([
      ['HttpException com mensagem string', new NotFoundException('x')],
      ['erro do Prisma', prismaError('P2025')],
      ['erro genérico', new Error('falhou')],
    ])('não inclui errors em %s', (_caso, exception) => {
      const { body } = run(exception);

      expect(body).not.toHaveProperty('errors');
    });
  });

  describe('erros do body-parser do Express', () => {
    it('traduz entity.too.large em 413 com mensagem em português', () => {
      const { response, body } = run(
        bodyParserError('entity.too.large', 413, 'request entity too large'),
        '/auth/login',
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
      expect(body.statusCode).toBe(413);
      expect(body.error).toBe('Payload Too Large');
      expect(body.message).toBe('Corpo da requisição muito grande');
      expect(body.path).toBe('/auth/login');
    });

    it('traduz entity.parse.failed em 400 sem vazar a mensagem nem o corpo', () => {
      const exception = Object.assign(
        bodyParserError(
          'entity.parse.failed',
          400,
          'Unexpected end of JSON input',
          new SyntaxError('Unexpected end of JSON input'),
        ),
        { body: '{"senha":"segredo' },
      );

      const { response, body } = run(exception);
      const serialized = JSON.stringify(body);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toBe('Corpo da requisição inválido');
      expect(serialized).not.toContain('Unexpected');
      expect(serialized).not.toContain('segredo');
    });

    it('traduz querystring.parse.rangeError (urlencoded fundo demais) em 400 sem vazar a mensagem', () => {
      const { response, body } = run(
        bodyParserError(
          'querystring.parse.rangeError',
          400,
          'The input exceeded the depth',
          new RangeError('The input exceeded the depth'),
        ),
      );

      expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(body.error).toBe('Bad Request');
      expect(body.message).toBe('Corpo da requisição inválido');
      expect(JSON.stringify(body)).not.toContain('depth');
    });

    it('repassa outro 4xx do parser com o status original e mensagem genérica', () => {
      const { response, body } = run(
        bodyParserError(
          'encoding.unsupported',
          415,
          'unsupported content encoding "br"',
        ),
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
      expect(body.error).toBe('Unsupported Media Type');
      expect(body.message).toBe('Requisição inválida');
      expect(JSON.stringify(body)).not.toContain('encoding');
    });

    it('não registra no Logger.error os 4xx do parser', () => {
      run(bodyParserError('entity.too.large', 413, 'request entity too large'));

      expect(loggerError).not.toHaveBeenCalled();
    });

    it('mantém 500 genérico e registra no Logger quando o parser falha com 5xx', () => {
      const { response, body } = run(
        bodyParserError('stream.not.readable', 500, 'stream is not readable'),
      );

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(body.message).toBe('Erro interno do servidor');
      expect(loggerError).toHaveBeenCalled();
    });

    it('não repassa o status de um erro com status 4xx que não veio do parser', () => {
      const exception = Object.assign(new Error('não encontrado no cache'), {
        status: 404,
      });

      const { response, body } = run(exception);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(body.message).toBe('Erro interno do servidor');
    });
  });

  describe('cabeçalhos herdados de um arquivo estático', () => {
    // O send (assets do /docs) grava os cabeçalhos do arquivo antes de emitir
    // o 412/416; sem limpar, o JSON de erro sairia como text/css com o ETag do
    // arquivo.
    const FILE_HEADERS = [
      'Content-Type',
      'Content-Length',
      'ETag',
      'Last-Modified',
      'Cache-Control',
      'Accept-Ranges',
    ];

    it('remove os cabeçalhos do arquivo antes de responder o JSON de erro', () => {
      const { response } = run(new HttpException('x', 412));

      for (const header of FILE_HEADERS) {
        expect(response.removeHeader).toHaveBeenCalledWith(header);
      }
      expect(response.removeHeader).toHaveBeenCalledTimes(FILE_HEADERS.length);
    });

    it('mantém o Content-Range (exigido no 416)', () => {
      const { response } = run(new HttpException('x', 416));

      expect(response.removeHeader).not.toHaveBeenCalledWith('Content-Range');
    });

    it('remove os cabeçalhos antes do json', () => {
      const { response } = run(new NotFoundException('x'));

      const lastRemove = Math.max(
        ...response.removeHeader.mock.invocationCallOrder,
      );
      expect(lastRemove).toBeLessThan(
        response.json.mock.invocationCallOrder[0],
      );
    });

    it('não mexe nos cabeçalhos quando eles já foram enviados', () => {
      const { host, response } = createHost('/x', 'GET', true);

      new AllExceptionsFilter().catch(new NotFoundException('x'), host);

      expect(response.removeHeader).not.toHaveBeenCalled();
    });
  });

  describe('erro genérico', () => {
    it('responde 500 sem vazar a mensagem nem a stack e registra no Logger', () => {
      const exception = new Error('senha do banco: xyz');

      const { response, body } = run(exception);
      const serialized = JSON.stringify(body);

      expect(response.status).toHaveBeenCalledWith(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect(body.error).toBe('Internal Server Error');
      expect(body.message).toBe('Erro interno do servidor');
      expect(serialized).not.toContain('senha do banco');
      expect(serialized).not.toContain('xyz');
      expect(serialized).not.toContain(exception.stack as string);
      expect(loggerError).toHaveBeenCalledWith(
        expect.stringContaining('GET /listings/123'),
        exception.stack,
      );
    });
  });
});
