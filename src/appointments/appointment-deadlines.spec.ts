import { deadlineFor } from './appointment-deadlines.js';

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
