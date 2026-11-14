import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppExpressAdapter } from './app-express.adapter.js';

function parseFailed() {
  return Object.assign(new SyntaxError('Unexpected end of JSON input'), {
    type: 'entity.parse.failed',
    status: 400,
  });
}

/** Imita um erro do pacote http-errors (Express, body-parser, send). */
function httpError(
  status: number,
  message: string,
  { expose = status < 500, base = new Error(message) } = {},
) {
  return Object.assign(base, { status, statusCode: status, expose });
}

/**
 * Imita o erro de descompressão do corpo: o body-parser passa o erro do zlib
 * pelo http-errors, que reaproveita o próprio objeto (com o `code` do zlib).
 */
function decompressionError(code: string, message: string) {
  return httpError(400, message, {
    base: Object.assign(new Error(message), { code, errno: -3 }),
  });
}

describe('AppExpressAdapter.mapException', () => {
  const adapter = new AppExpressAdapter();

  function mapToHttpException(error: unknown): HttpException {
    const mapped = adapter.mapException(error);
    expect(mapped).toBeInstanceOf(HttpException);
    return mapped as HttpException;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('entrega o SyntaxError do body-parser intacto, sem virar BadRequestException', () => {
    const error = parseFailed();

    expect(adapter.mapException(error)).toBe(error);
  });

  it('entrega intacto o erro de corpo grande do body-parser', () => {
    const error = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });

    expect(adapter.mapException(error)).toBe(error);
  });

  it('entrega intacto o erro de profundidade do corpo urlencoded', () => {
    const error = Object.assign(
      new RangeError('The input exceeded the depth'),
      {
        type: 'querystring.parse.rangeError',
        status: 400,
        statusCode: 400,
        expose: true,
      },
    );

    expect(adapter.mapException(error)).toBe(error);
  });

  // Comportamento padrão do Nest (12.5+): só um SyntaxError/URIError com
  // status 400 vira BadRequestException. Sem status, ele veio do código do
  // servidor e pode carregar detalhes internos na mensagem, então segue
  // intacto e o AllExceptionsFilter responde 500 genérico (e registra no log).
  it('mantém intacto um SyntaxError sem status que não veio do parser', () => {
    const error = new SyntaxError('outro erro');

    expect(adapter.mapException(error)).toBe(error);
  });

  it('converte em BadRequestException com mensagem em português um SyntaxError com status 400 que não veio do parser', () => {
    const error = Object.assign(new SyntaxError('outro erro'), { status: 400 });

    const mapped = adapter.mapException(error);

    expect(mapped).toBeInstanceOf(BadRequestException);
    expect((mapped as BadRequestException).message).toBe('Requisição inválida');
    expect(
      JSON.stringify((mapped as BadRequestException).getResponse()),
    ).not.toContain('outro erro');
  });

  it('devolve sem alteração um erro comum', () => {
    const error = new Error('falhou');

    expect(adapter.mapException(error)).toBe(error);
  });

  describe('erros da camada do Express que viram HttpException', () => {
    it('responde "Parâmetro inválido na URL" ao URIError do router sem repetir o parâmetro', () => {
      const error = Object.assign(
        new URIError("Failed to decode param '%FF'"),
        {
          status: 400,
        },
      );

      const mapped = mapToHttpException(error);

      expect(mapped).toBeInstanceOf(BadRequestException);
      expect(mapped.getStatus()).toBe(400);
      expect(mapped.message).toBe('Parâmetro inválido na URL');
      expect(JSON.stringify(mapped.getResponse())).not.toMatch(/%FF|decode/);
    });

    it('guarda o erro original em cause, para depuração', () => {
      const error = Object.assign(
        new URIError("Failed to decode param '%FF'"),
        {
          status: 400,
        },
      );

      expect(mapToHttpException(error).cause).toBe(error);
    });

    it.each([
      [400, 'Requisição inválida'],
      [403, 'Acesso negado'],
      [404, 'Recurso não encontrado'],
      [412, 'Pré-condição da requisição não atendida'],
      [413, 'Corpo da requisição muito grande'],
      [415, 'Formato da requisição não suportado'],
      [416, 'Intervalo solicitado inválido'],
    ])(
      'responde ao http-error %i com a mensagem do mapa em português',
      (status, message) => {
        const mapped = mapToHttpException(
          httpError(status, 'texto cru do middleware'),
        );

        expect(mapped.getStatus()).toBe(status);
        expect(mapped.message).toBe(message);
      },
    );

    it('responde o 412 do send (expose: false) com a mensagem em português', () => {
      const mapped = mapToHttpException(
        httpError(412, 'Precondition Failed', { expose: false }),
      );

      expect(mapped.getStatus()).toBe(412);
      expect(mapped.message).toBe('Pré-condição da requisição não atendida');
    });

    it('usa "Requisição inválida" num 405 (fora do mapa, o Express não o emite)', () => {
      const mapped = mapToHttpException(httpError(405, 'Method Not Allowed'));

      expect(mapped.getStatus()).toBe(405);
      expect(mapped.message).toBe('Requisição inválida');
    });

    it('usa "Requisição inválida" num http-error de status fora do mapa, nunca error.message', () => {
      const mapped = mapToHttpException(
        httpError(418, 'segredo interno em /srv/app'),
      );

      expect(mapped.getStatus()).toBe(418);
      expect(mapped.message).toBe('Requisição inválida');
      expect(JSON.stringify(mapped.getResponse())).not.toContain('segredo');
    });

    it.each([
      ['gzip/deflate corrompido', 'Z_DATA_ERROR', 'incorrect header check'],
      ['gzip truncado', 'Z_BUF_ERROR', 'unexpected end of file'],
      [
        'brotli corrompido',
        'ERR__ERROR_FORMAT_PADDING_2',
        'Decompression failed',
      ],
      [
        'zstd corrompido',
        'ZSTD_error_prefix_unknown',
        'Unknown frame descriptor',
      ],
    ])(
      'responde "Corpo da requisição inválido" ao erro de descompressão (%s)',
      (_caso, code, message) => {
        const mapped = mapToHttpException(decompressionError(code, message));

        expect(mapped.getStatus()).toBe(400);
        expect(mapped.message).toBe('Corpo da requisição inválido');
        expect(JSON.stringify(mapped.getResponse())).not.toContain(message);
      },
    );

    it('cai em "Requisição inválida" num http-error 400 sem código de descompressão reconhecido', () => {
      const mapped = mapToHttpException(
        decompressionError('ALGUM_CODIGO_NOVO', 'mensagem crua do zlib'),
      );

      expect(mapped.message).toBe('Requisição inválida');
    });

    it('mantém intacto um http-error 5xx, para o filtro responder 500 genérico e registrar no log', () => {
      const error = httpError(
        500,
        'EACCES: permission denied, open /srv/app/x',
      );

      expect(adapter.mapException(error)).toBe(error);
    });

    // Hoje o Nest não converte 5xx; se uma versão futura converter, o erro
    // precisa seguir intacto para o filtro responder 500 genérico com log, em
    // vez de um HttpException 500 com "Requisição inválida" e sem log.
    it('devolve o erro original quando o framework o converte num HttpException 5xx', () => {
      const error = httpError(
        500,
        'EACCES: permission denied, open /srv/app/x',
      );
      vi.spyOn(ExpressAdapter.prototype, 'mapException').mockReturnValue(
        new HttpException(error.message, 500, { cause: error }),
      );

      expect(adapter.mapException(error)).toBe(error);
    });
  });
});

describe('AppExpressAdapter.setNotFoundHandler (risco 68)', () => {
  /** Registra o handler e devolve o middleware que o adapter montou no Express. */
  function registeredMiddleware(original: () => void) {
    const adapter = new AppExpressAdapter();
    const use = vi.spyOn(adapter, 'use').mockReturnValue(undefined);
    adapter.setNotFoundHandler(original);
    expect(use).toHaveBeenCalledTimes(1);
    return use.mock.calls[0][0] as (
      req: unknown,
      res: unknown,
      next: (error?: unknown) => void,
    ) => void;
  }

  it('passa adiante um 404 "Rota não encontrada", sem repetir o método nem a URL', () => {
    const original = vi.fn();
    const next = vi.fn();
    const middleware = registeredMiddleware(original);

    middleware({ originalUrl: '/docs/swagger-ui.css%00', method: 'GET' }, {}, next);

    expect(original).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0] as NotFoundException;
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Rota não encontrada');
    expect(JSON.stringify(error.getResponse())).not.toMatch(/GET|swagger|%00/);
  });

  it('o 404 de rota passa intacto pelo mapException', () => {
    const adapter = new AppExpressAdapter();
    const error = new NotFoundException('Rota não encontrada');

    expect(adapter.mapException(error)).toBe(error);
  });
});

describe('AppExpressAdapter: code dos erros da camada do Express', () => {
  const adapter = new AppExpressAdapter();

  function codeOf(error: unknown): unknown {
    const mapped = adapter.mapException(error) as HttpException;
    return (mapped.getResponse() as { code?: unknown }).code;
  }

  it('responde INVALID_URL_PARAM ao URIError do router', () => {
    expect(
      codeOf(Object.assign(new URIError("Failed to decode param '%FF'"), { status: 400 })),
    ).toBe('INVALID_URL_PARAM');
  });

  it('responde INVALID_BODY ao erro de descompressão', () => {
    expect(codeOf(decompressionError('Z_DATA_ERROR', 'incorrect header check'))).toBe(
      'INVALID_BODY',
    );
  });

  it.each([
    [400, 'BAD_REQUEST'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [405, 'BAD_REQUEST'],
    [412, 'PRECONDITION_FAILED'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [416, 'RANGE_NOT_SATISFIABLE'],
    [418, 'BAD_REQUEST'],
  ])('responde ao http-error %i com o code %s', (status, code) => {
    expect(codeOf(httpError(status, 'texto cru'))).toBe(code);
  });

  it('responde ROUTE_NOT_FOUND à rota inexistente', () => {
    const local = new AppExpressAdapter();
    const use = vi.spyOn(local, 'use').mockReturnValue(undefined);
    local.setNotFoundHandler(vi.fn());
    const middleware = use.mock.calls[0][0] as (
      req: unknown,
      res: unknown,
      next: (error?: unknown) => void,
    ) => void;
    const next = vi.fn();

    middleware({ originalUrl: '/nao-existe', method: 'GET' }, {}, next);

    const error = next.mock.calls[0][0] as NotFoundException;
    expect(error.getResponse()).toEqual({
      code: 'ROUTE_NOT_FOUND',
      message: 'Rota não encontrada',
    });
  });
});
