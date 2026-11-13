import { BadRequestException } from '@nestjs/common';
import { AppExpressAdapter } from './app-express.adapter.js';

function parseFailed() {
  return Object.assign(new SyntaxError('Unexpected end of JSON input'), {
    type: 'entity.parse.failed',
    status: 400,
  });
}

describe('AppExpressAdapter.mapException', () => {
  const adapter = new AppExpressAdapter();

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

  // Comportamento padrão do Nest (12.5+): só um SyntaxError/URIError com
  // status 400 vira BadRequestException. Sem status, ele veio do código do
  // servidor e pode carregar detalhes internos na mensagem, então segue
  // intacto e o AllExceptionsFilter responde 500 genérico (e registra no log).
  it('mantém intacto um SyntaxError sem status que não veio do parser', () => {
    const error = new SyntaxError('outro erro');

    expect(adapter.mapException(error)).toBe(error);
  });

  it('converte em BadRequestException um SyntaxError com status 400 que não veio do parser', () => {
    const error = Object.assign(new SyntaxError('outro erro'), { status: 400 });

    const mapped = adapter.mapException(error);

    expect(mapped).toBeInstanceOf(BadRequestException);
    expect((mapped as BadRequestException).message).toBe('outro erro');
  });

  it('devolve sem alteração um erro comum', () => {
    const error = new Error('falhou');

    expect(adapter.mapException(error)).toBe(error);
  });
});
