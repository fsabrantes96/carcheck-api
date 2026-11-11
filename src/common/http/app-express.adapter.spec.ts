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

  it('mantém o comportamento padrão para SyntaxError que não veio do parser', () => {
    const mapped = adapter.mapException(new SyntaxError('outro erro'));

    expect(mapped).toBeInstanceOf(BadRequestException);
    expect((mapped as BadRequestException).message).toBe('outro erro');
  });

  it('devolve sem alteração um erro comum', () => {
    const error = new Error('falhou');

    expect(adapter.mapException(error)).toBe(error);
  });
});
