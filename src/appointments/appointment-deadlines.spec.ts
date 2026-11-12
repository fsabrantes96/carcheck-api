import type { AppointmentStatus } from '../generated/prisma/client.js';
import { deadlineFor, dueWhere, expiredData, isDue } from './appointment-deadlines.js';
import { EXPIRABLE_STATUSES } from './appointments.constants.js';
import { decide } from './appointments.state-machine.js';

const now = new Date('2030-01-01T12:00:00.000Z');
const farStart = new Date('2030-01-20T12:00:00.000Z');

describe('deadlineFor', () => {
  it.each([
    ['REQUESTED', '2030-01-02T12:00:00.000Z'],
    ['ACCEPTED', '2030-01-02T12:00:00.000Z'],
    ['AWAITING_PAYMENT', '2030-01-01T12:30:00.000Z'],
  ] as const)('%s com início distante: entrada + janela (%s)', (status, expected) => {
    expect(deadlineFor(status, now, farStart)).toEqual(new Date(expected));
  });

  it.each(['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] as const)(
    '%s nunca passa do início da avaliação',
    (status) => {
      const soon = new Date('2030-01-01T12:10:00.000Z');

      expect(deadlineFor(status, now, soon)).toEqual(soon);
    },
  );

  it('quando a janela termina exatamente no início, o prazo é o início', () => {
    const start = new Date('2030-01-02T12:00:00.000Z');

    expect(deadlineFor('REQUESTED', now, start)).toEqual(start);
  });
});

const ALL_STATUSES: AppointmentStatus[] = [
  'REQUESTED',
  'ACCEPTED',
  'AWAITING_PAYMENT',
  'PAID',
  'REPORT_SUBMITTED',
  'DISPUTED',
  'COMPLETED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
];

describe('EXPIRABLE_STATUSES', () => {
  it.each(ALL_STATUSES)('%s: está na lista se e só se a máquina de estados permite EXPIRE', (status) => {
    expect(EXPIRABLE_STATUSES.includes(status)).toBe(decide('SYSTEM', 'EXPIRE', status).ok);
  });
});

describe('isDue', () => {
  const past = new Date('2030-01-01T11:59:59.999Z');
  const future = new Date('2030-01-01T12:00:00.001Z');

  it.each(['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] as const)('%s com prazo no passado está vencido', (status) => {
    expect(isDue(status, past, now)).toBe(true);
  });

  it.each(['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] as const)(
    '%s com prazo exatamente agora está vencido (expiresAt <= agora)',
    (status) => {
      expect(isDue(status, new Date(now), now)).toBe(true);
    },
  );

  it.each(['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] as const)('%s com prazo no futuro não está vencido', (status) => {
    expect(isDue(status, future, now)).toBe(false);
  });

  it('estado expirável sem prazo (expiresAt null) não está vencido', () => {
    expect(isDue('REQUESTED', null, now)).toBe(false);
  });

  it.each(ALL_STATUSES.filter((status) => !EXPIRABLE_STATUSES.includes(status)))(
    '%s nunca está vencido, mesmo com prazo no passado',
    (status) => {
      expect(isDue(status, past, now)).toBe(false);
    },
  );
});

describe('dueWhere', () => {
  it('sem status, filtra os três estados expiráveis com expiresAt <= agora', () => {
    expect(dueWhere(now)).toEqual({
      status: { in: ['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] },
      expiresAt: { lte: now },
    });
  });

  it('com uma lista, filtra só os estados da lista', () => {
    expect(dueWhere(now, ['ACCEPTED', 'AWAITING_PAYMENT'])).toEqual({
      status: { in: ['ACCEPTED', 'AWAITING_PAYMENT'] },
      expiresAt: { lte: now },
    });
  });

  it('com um status só, filtra por igualdade', () => {
    expect(dueWhere(now, 'ACCEPTED')).toEqual({ status: 'ACCEPTED', expiresAt: { lte: now } });
  });

  it.each(['PAID', 'REPORT_SUBMITTED', 'DISPUTED', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED'] as const)(
    'lança RangeError quando recebe %s, que não expira (nunca expirar dinheiro retido)',
    (status) => {
      expect(() => dueWhere(now, status)).toThrow(RangeError);
      expect(() => dueWhere(now, status)).toThrow(`dueWhere: o estado ${status} não expira`);
    },
  );

  it('lança RangeError quando a lista tem um estado que não expira', () => {
    expect(() => dueWhere(now, ['ACCEPTED', 'PAID'])).toThrow('dueWhere: o estado PAID não expira');
  });

  it('não reaproveita a lista recebida (cópia no filtro)', () => {
    const statuses: AppointmentStatus[] = ['ACCEPTED'];

    const where = dueWhere(now, statuses);

    expect((where.status as { in: AppointmentStatus[] }).in).not.toBe(statuses);
  });
});

describe('expiredData', () => {
  it('grava EXPIRED, encerrado pelo SYSTEM, com endedAt = agora', () => {
    expect(expiredData(now)).toEqual({ status: 'EXPIRED', endedBy: 'SYSTEM', endedAt: now });
  });
});
