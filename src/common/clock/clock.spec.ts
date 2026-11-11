import { Test } from '@nestjs/testing';
import { FakeClock } from '../../../test/support/fake-clock.js';
import { CLOCK, ClockModule, SystemClock } from './clock.js';
import type { Clock } from './clock.js';

describe('SystemClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('devolve a hora do sistema', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-05-06T07:08:09.000Z'));

    expect(new SystemClock().now()).toEqual(new Date('2031-05-06T07:08:09.000Z'));
  });

  it('o ClockModule fornece o SystemClock pelo token CLOCK', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ClockModule] }).compile();

    expect(moduleRef.get<Clock>(CLOCK)).toBeInstanceOf(SystemClock);
  });
});

describe('FakeClock', () => {
  it('começa na data informada', () => {
    expect(new FakeClock('2030-02-03T04:05:06.000Z').now()).toEqual(
      new Date('2030-02-03T04:05:06.000Z'),
    );
  });

  it('avança minutos e horas', () => {
    const clock = new FakeClock('2030-01-01T00:00:00.000Z');

    clock.advanceHours(24);
    clock.advanceMinutes(1);

    expect(clock.now()).toEqual(new Date('2030-01-02T00:01:00.000Z'));
  });

  it('set troca a hora atual', () => {
    const clock = new FakeClock();

    clock.set('2035-01-01T00:00:00.000Z');

    expect(clock.now()).toEqual(new Date('2035-01-01T00:00:00.000Z'));
  });

  it('devolve uma cópia: alterar o Date devolvido não muda o relógio', () => {
    const clock = new FakeClock('2030-01-01T00:00:00.000Z');

    clock.now().setFullYear(1999);

    expect(clock.now()).toEqual(new Date('2030-01-01T00:00:00.000Z'));
  });
});
