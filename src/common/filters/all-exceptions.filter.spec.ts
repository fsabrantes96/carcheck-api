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
