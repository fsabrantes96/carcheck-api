import { ListingStatus } from '../generated/prisma/client.js';
import { decideListingTransition } from './listings.state-machine.js';
import type { ListingAction } from './listings.state-machine.js';

// Matriz completa (4 ações × 4 status), escrita à mão a partir do desenho
// aprovado. Não é gerada a partir da tabela TRANSITIONS de propósito: se a
// tabela mudar, este teste precisa discordar dela.
const matrix: [ListingAction, ListingStatus, ListingStatus | 'INVALID_STATE'][] = [
  ['PAUSE', 'ACTIVE', 'PAUSED'],
  ['PAUSE', 'PAUSED', 'INVALID_STATE'],
  ['PAUSE', 'SOLD', 'INVALID_STATE'],
  ['PAUSE', 'ARCHIVED', 'INVALID_STATE'],

  ['ACTIVATE', 'ACTIVE', 'INVALID_STATE'],
  ['ACTIVATE', 'PAUSED', 'ACTIVE'],
  ['ACTIVATE', 'SOLD', 'INVALID_STATE'],
  ['ACTIVATE', 'ARCHIVED', 'INVALID_STATE'],

  ['MARK_SOLD', 'ACTIVE', 'SOLD'],
  ['MARK_SOLD', 'PAUSED', 'SOLD'],
  ['MARK_SOLD', 'SOLD', 'INVALID_STATE'],
  ['MARK_SOLD', 'ARCHIVED', 'INVALID_STATE'],

  ['ARCHIVE', 'ACTIVE', 'ARCHIVED'],
  ['ARCHIVE', 'PAUSED', 'ARCHIVED'],
  ['ARCHIVE', 'SOLD', 'ARCHIVED'],
  ['ARCHIVE', 'ARCHIVED', 'INVALID_STATE'],
];

describe('decideListingTransition', () => {
  it('a matriz cobre todas as combinações de ação e status', () => {
    const actions: ListingAction[] = ['PAUSE', 'ACTIVATE', 'MARK_SOLD', 'ARCHIVE'];
    // Vem do enum gerado: um status novo no schema obriga a atualizar a matriz.
    const statuses = Object.values(ListingStatus);
    const all = actions.flatMap((a) => statuses.map((s) => `${a}:${s}`));
    const covered = matrix.map(([a, s]) => `${a}:${s}`);

    expect([...covered].sort()).toEqual([...all].sort());
  });

  it.each(matrix.filter(([, , expected]) => expected !== 'INVALID_STATE'))(
    '%s em %s leva a %s',
    (action, current, expected) => {
      expect(decideListingTransition(action, current)).toEqual({
        ok: true,
        to: expected,
      });
    },
  );

  it.each(matrix.filter(([, , expected]) => expected === 'INVALID_STATE'))(
    '%s em %s é recusado (INVALID_STATE)',
    (action, current) => {
      expect(decideListingTransition(action, current)).toEqual({
        ok: false,
        reason: 'INVALID_STATE',
      });
    },
  );
});
