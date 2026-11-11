import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Fonte da hora atual para prazos (expiração, antecedência mínima). Toda
 * regra de tempo usa este relógio, nunca o now() do banco, para os testes
 * conseguirem controlar o tempo (ver FakeClock em test/support/fake-clock.ts).
 */
export interface Clock {
  now(): Date;
}

/** Token de injeção: `@Inject(CLOCK) clock: Clock`. */
export const CLOCK = Symbol('CLOCK');

/** Relógio real da aplicação. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
