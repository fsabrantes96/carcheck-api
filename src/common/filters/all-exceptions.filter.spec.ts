import {
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '../../generated/prisma/client.js';
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

function createHost(url = '/listings/123', method = 'GET') {
  const request = { url, method };
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
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
