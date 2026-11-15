import { HttpStatus, UnsupportedMediaTypeException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ACCEPTED_BODY_CONTENT_TYPES } from '../limits.js';
import { rejectUnsupportedContentType } from './unsupported-content-type.middleware.js';

/**
 * Requisição de mentira: `is` imita o req.is do Express (type-is), que
 * devolve o tipo casado ou false. A comparação real de Content-Type (charset,
 * maiúsculas, espaços) é coberta nos e2e, com o Express de verdade.
 */
function fakeRequest(headers: Record<string, string>, matches: boolean) {
  return {
    headers,
    is: vi.fn().mockReturnValue(matches ? 'application/json' : false),
  };
}

function run(headers: Record<string, string>, matches: boolean) {
  const req = fakeRequest(headers, matches);
  const next = vi.fn();
  rejectUnsupportedContentType(
    req as unknown as Request,
    {} as Response,
    next as NextFunction,
  );
  return { req, next };
}

describe('rejectUnsupportedContentType', () => {
  it('aceita JSON e urlencoded, os tipos que a API sabe ler', () => {
    expect(ACCEPTED_BODY_CONTENT_TYPES).toEqual([
      'application/json',
      'application/x-www-form-urlencoded',
    ]);
  });

  it('deixa passar uma requisição sem corpo (sem Content-Length nem Transfer-Encoding)', () => {
    const { req, next } = run({}, false);

    expect(next).toHaveBeenCalledWith();
    expect(req.is).not.toHaveBeenCalled();
  });

  it('deixa passar Content-Length: 0 mesmo com Content-Type text/plain', () => {
    const { next } = run({ 'content-length': '0', 'content-type': 'text/plain' }, false);

    expect(next).toHaveBeenCalledWith();
  });

  it('deixa passar um corpo de tipo aceito, consultando a lista única de tipos', () => {
    const { req, next } = run(
      { 'content-length': '2', 'content-type': 'application/json' },
      true,
    );

    expect(next).toHaveBeenCalledWith();
    expect(req.is).toHaveBeenCalledWith(ACCEPTED_BODY_CONTENT_TYPES);
  });

  it.each([
    ['Content-Length', { 'content-length': '1', 'content-type': 'text/plain' }],
    ['Transfer-Encoding', { 'transfer-encoding': 'chunked', 'content-type': 'text/plain' }],
    ['corpo sem Content-Type', { 'content-length': '5' }],
  ])(
    'passa ao filtro um 415 "Formato da requisição não suportado" (%s)',
    (_caso, headers) => {
      const { next } = run(headers, false);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0] as UnsupportedMediaTypeException;
      expect(error).toBeInstanceOf(UnsupportedMediaTypeException);
      expect(error.getStatus()).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      expect(error.message).toBe('Formato da requisição não suportado');
    },
  );

  it('passa o 415 com o code UNSUPPORTED_MEDIA_TYPE', () => {
    const { next } = run({ 'content-length': '1', 'content-type': 'text/plain' }, false);

    const error = next.mock.calls[0][0] as UnsupportedMediaTypeException;
    expect(error.getResponse()).toEqual({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Formato da requisição não suportado',
    });
  });

  it('não responde sozinho: só chama next', () => {
    const res = { status: vi.fn(), json: vi.fn(), send: vi.fn(), end: vi.fn() };
    const next = vi.fn();

    rejectUnsupportedContentType(
      fakeRequest({ 'content-length': '1', 'content-type': 'text/plain' }, false) as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(res)) expect(fn).not.toHaveBeenCalled();
  });
});
