import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ROLES_KEY } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { InspectorsController } from './inspectors.controller.js';

type Handler = (...args: never[]) => unknown;

function handler(name: 'findAll' | 'create' | 'findMine' | 'update'): Handler {
  return InspectorsController.prototype[name] as Handler;
}

describe('InspectorsController (guards e roles)', () => {
  it('GET / (findAll) não tem guard', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, handler('findAll')),
    ).toBeUndefined();
  });

  it('GET / (findAll) não exige roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, handler('findAll'))).toBeUndefined();
  });

  it('POST me (create) usa só o JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler('create'))).toEqual([
      JwtAuthGuard,
    ]);
  });

  it('POST me (create) não exige roles (qualquer usuário pode virar avaliador)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, handler('create'))).toBeUndefined();
  });

  it.each(['findMine', 'update'] as const)(
    '%s usa [JwtAuthGuard, RolesGuard] nessa ordem',
    (name) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler(name))).toEqual([
        JwtAuthGuard,
        RolesGuard,
      ]);
    },
  );

  it.each(['findMine', 'update'] as const)(
    '%s exige @Roles("INSPECTOR")',
    (name) => {
      expect(Reflect.getMetadata(ROLES_KEY, handler(name))).toEqual([
        'INSPECTOR',
      ]);
    },
  );

  it('a classe InspectorsController não declara guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, InspectorsController),
    ).toBeUndefined();
  });

  it('a classe InspectorsController não declara roles', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InspectorsController)).toBeUndefined();
  });
});
