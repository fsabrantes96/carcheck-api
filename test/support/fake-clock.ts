import type { Clock } from '../../src/common/clock/clock.js';

/**
 * Relógio controlável para testes (unitários e e2e). Substitui o CLOCK:
 * `createTestApp({ configure: (b) => b.overrideProvider(CLOCK).useValue(clock) })`.
 * Devolve sempre uma cópia, para ninguém alterar a hora de fora.
 */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2030-01-01T12:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date | string): void {
    this.current = new Date(date);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceMinutes(minutes: number): void {
    this.advanceMs(minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMs(hours * 3_600_000);
  }
}
