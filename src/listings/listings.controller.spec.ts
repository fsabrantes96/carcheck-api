import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
} from '@nestjs/common/constants.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ListingsController } from './listings.controller.js';

type HandlerName =
  | 'findAll'
  | 'findOne'
  | 'findMine'
  | 'create'
  | 'update'
  | 'remove';
type Handler = (...args: never[]) => unknown;

function handler(name: HandlerName): Handler {
  return ListingsController.prototype[name] as Handler;
}

describe('ListingsController (guards e status codes)', () => {
  it.each(['findAll', 'findOne'] as const)(
    '%s é público (sem guard)',
    (name) => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, handler(name)),
      ).toBeUndefined();
    },
  );

  it.each(['findMine', 'create', 'update', 'remove'] as const)(
    '%s usa só o JwtAuthGuard',
    (name) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler(name))).toEqual([
        JwtAuthGuard,
      ]);
    },
  );

  it('a classe ListingsController não declara guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ListingsController),
    ).toBeUndefined();
  });

  it('remove responde 204 (HttpCode explícito)', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('remove'))).toBe(
      204,
    );
  });
});
