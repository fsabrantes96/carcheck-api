import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { AppointmentsController } from './appointments.controller.js';

type Handler = (...args: never[]) => unknown;

function handler(name: keyof AppointmentsController): Handler {
  return AppointmentsController.prototype[name] as Handler;
}

describe('AppointmentsController (guards e limites)', () => {
  it('a classe usa só o JwtAuthGuard (sem RolesGuard: vale o papel no agendamento)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, AppointmentsController) as unknown[];

    expect(guards).toEqual([JwtAuthGuard]);
    expect(guards).not.toContain(RolesGuard);
  });

  it('create tem limite próprio de 10 por minuto', () => {
    // @nestjs/throttler grava o limite e o ttl por throttler no handler.
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler('create')) as number;
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler('create')) as number;

    expect(limit).toBe(10);
    expect(ttl).toBe(60_000);
  });
});
