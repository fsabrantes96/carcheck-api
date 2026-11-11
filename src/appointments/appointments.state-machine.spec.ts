import { AppointmentStatus } from '../generated/prisma/client.js';
import {
  availableActions,
  decide,
  participantOf,
  ROUTE_ACTIONS,
} from './appointments.state-machine.js';
import type { Actor, AppointmentAction, Participant } from './appointments.state-machine.js';

type Status = AppointmentStatus;

// ---------------------------------------------------------------------------
// Especificação ESCRITA À MÃO a partir do desenho aprovado
// (docs/appointments-design.md, seção 3). Não importa nem deriva nada das
// tabelas do código: se o código mudar, este teste precisa discordar.
// ---------------------------------------------------------------------------

/** Quem pode executar cada ação (independe do estado). */
const WHO_CAN: Record<AppointmentAction, Actor[]> = {
  ACCEPT: ['INSPECTOR'],
  DECLINE: ['INSPECTOR'],
  CONFIRM: ['SELLER'],
  CANCEL: ['BUYER', 'SELLER', 'INSPECTOR'],
  EXPIRE: ['SYSTEM'],
  MARK_PAID: ['SYSTEM'],
  SUBMIT_REPORT: ['INSPECTOR'],
  APPROVE: ['BUYER'],
  OPEN_DISPUTE: ['BUYER'],
  AUTO_RELEASE: ['SYSTEM'],
};

/** Todas as transições permitidas, uma por linha: [ator, ação, de, para]. */
const ALLOWED: [Actor, AppointmentAction, Status, Status][] = [
  ['INSPECTOR', 'ACCEPT', 'REQUESTED', 'ACCEPTED'],
  ['INSPECTOR', 'DECLINE', 'REQUESTED', 'DECLINED'],
  ['SELLER', 'CONFIRM', 'ACCEPTED', 'AWAITING_PAYMENT'],

  ['BUYER', 'CANCEL', 'REQUESTED', 'CANCELLED'],
  ['BUYER', 'CANCEL', 'ACCEPTED', 'CANCELLED'],
  ['BUYER', 'CANCEL', 'AWAITING_PAYMENT', 'CANCELLED'],
  ['SELLER', 'CANCEL', 'REQUESTED', 'CANCELLED'],
  ['SELLER', 'CANCEL', 'ACCEPTED', 'CANCELLED'],
  ['SELLER', 'CANCEL', 'AWAITING_PAYMENT', 'CANCELLED'],
  ['INSPECTOR', 'CANCEL', 'REQUESTED', 'CANCELLED'],
  ['INSPECTOR', 'CANCEL', 'ACCEPTED', 'CANCELLED'],
  ['INSPECTOR', 'CANCEL', 'AWAITING_PAYMENT', 'CANCELLED'],

  ['SYSTEM', 'EXPIRE', 'REQUESTED', 'EXPIRED'],
  ['SYSTEM', 'EXPIRE', 'ACCEPTED', 'EXPIRED'],
  ['SYSTEM', 'EXPIRE', 'AWAITING_PAYMENT', 'EXPIRED'],

  // Declaradas: nenhuma rota chega nelas nesta branch.
  ['SYSTEM', 'MARK_PAID', 'AWAITING_PAYMENT', 'PAID'],
  ['INSPECTOR', 'SUBMIT_REPORT', 'PAID', 'REPORT_SUBMITTED'],
  ['BUYER', 'APPROVE', 'REPORT_SUBMITTED', 'COMPLETED'],
  ['BUYER', 'OPEN_DISPUTE', 'REPORT_SUBMITTED', 'DISPUTED'],
  ['SYSTEM', 'AUTO_RELEASE', 'REPORT_SUBMITTED', 'COMPLETED'],
];

const ACTORS: Actor[] = ['BUYER', 'SELLER', 'INSPECTOR', 'SYSTEM'];
const ACTIONS = Object.keys(WHO_CAN) as AppointmentAction[];
// Do enum gerado: um status novo no schema entra na matriz automaticamente
// (e cai em INVALID_STATE até alguém escrever a transição acima).
const STATUSES = Object.values(AppointmentStatus);

type Expected = Status | 'FORBIDDEN_ACTOR' | 'INVALID_STATE';

function expectedFor(actor: Actor, action: AppointmentAction, status: Status): Expected {
  if (!WHO_CAN[action].includes(actor)) return 'FORBIDDEN_ACTOR';
  const row = ALLOWED.find(([a, act, from]) => a === actor && act === action && from === status);
  return row ? row[3] : 'INVALID_STATE';
}

const MATRIX: [Actor, AppointmentAction, Status, Expected][] = ACTORS.flatMap((actor) =>
  ACTIONS.flatMap((action) =>
    STATUSES.map((status): [Actor, AppointmentAction, Status, Expected] => [
      actor,
      action,
      status,
      expectedFor(actor, action, status),
    ]),
  ),
);

describe('máquina de estados do agendamento', () => {
  describe('consistência da especificação escrita no teste', () => {
    it('cobre 4 atores × 10 ações × 10 estados = 400 combinações', () => {
      expect(ACTIONS).toHaveLength(10);
      expect(STATUSES).toHaveLength(10);
      expect(MATRIX).toHaveLength(400);
    });

    it('toda linha permitida usa um ator que pode executar a ação', () => {
      const incoherent = ALLOWED.filter(([actor, action]) => !WHO_CAN[action].includes(actor));
      expect(incoherent).toEqual([]);
    });
  });

  describe('decide(): matriz completa', () => {
    it.each(MATRIX.filter(([, , , e]) => e !== 'FORBIDDEN_ACTOR' && e !== 'INVALID_STATE'))(
      '%s %s em %s → %s',
      (actor, action, status, expected) => {
        expect(decide(actor, action, status)).toEqual({ ok: true, to: expected });
      },
    );

    it.each(MATRIX.filter(([, , , e]) => e === 'FORBIDDEN_ACTOR'))(
      '%s não pode %s (em %s): FORBIDDEN_ACTOR',
      (actor, action, status) => {
        expect(decide(actor, action, status)).toEqual({ ok: false, reason: 'FORBIDDEN_ACTOR' });
      },
    );

    it.each(MATRIX.filter(([, , , e]) => e === 'INVALID_STATE'))(
      '%s %s em %s: INVALID_STATE',
      (actor, action, status) => {
        expect(decide(actor, action, status)).toEqual({ ok: false, reason: 'INVALID_STATE' });
      },
    );
  });

  describe('estados finais e só declarados', () => {
    it.each(['COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED'] as Status[])(
      '%s é final: nenhuma ação de nenhum ator sai dele',
      (status) => {
        const exits = ACTORS.flatMap((actor) =>
          ACTIONS.filter((action) => decide(actor, action, status).ok),
        );
        expect(exits).toEqual([]);
      },
    );

    it('com as ações que têm rota (e a expiração do sistema), a partir de REQUESTED só se alcança REQUESTED, ACCEPTED, AWAITING_PAYMENT, DECLINED, CANCELLED e EXPIRED', () => {
      const actions: [Actor, AppointmentAction][] = [
        ...(['BUYER', 'SELLER', 'INSPECTOR'] as Actor[]).flatMap((actor) =>
          ROUTE_ACTIONS.map((action): [Actor, AppointmentAction] => [actor, action]),
        ),
        ['SYSTEM', 'EXPIRE'],
      ];
      const reached = new Set<Status>(['REQUESTED']);
      const queue: Status[] = ['REQUESTED'];
      while (queue.length > 0) {
        const current = queue.shift() as Status;
        for (const [actor, action] of actions) {
          const decision = decide(actor, action, current);
          if (decision.ok && !reached.has(decision.to)) {
            reached.add(decision.to);
            queue.push(decision.to);
          }
        }
      }

      expect([...reached].sort()).toEqual(
        ['ACCEPTED', 'AWAITING_PAYMENT', 'CANCELLED', 'DECLINED', 'EXPIRED', 'REQUESTED'].sort(),
      );
    });

    it('as rotas desta versão são exatamente accept, decline, confirm e cancel', () => {
      expect([...ROUTE_ACTIONS].sort()).toEqual(['ACCEPT', 'CANCEL', 'CONFIRM', 'DECLINE']);
    });
  });

  describe('availableActions()', () => {
    it.each([
      ['INSPECTOR', 'REQUESTED', ['ACCEPT', 'DECLINE', 'CANCEL']],
      ['BUYER', 'REQUESTED', ['CANCEL']],
      ['SELLER', 'REQUESTED', ['CANCEL']],
      ['SELLER', 'ACCEPTED', ['CONFIRM', 'CANCEL']],
      ['INSPECTOR', 'ACCEPTED', ['CANCEL']],
      ['BUYER', 'AWAITING_PAYMENT', ['CANCEL']],
      // PAID: o avaliador pode SUBMIT_REPORT na tabela, mas não há rota ainda.
      ['INSPECTOR', 'PAID', []],
      ['BUYER', 'REPORT_SUBMITTED', []],
      ['BUYER', 'CANCELLED', []],
    ] as [Participant, Status, AppointmentAction[]][])(
      '%s em %s: %j',
      (participant, status, expected) => {
        expect(availableActions(participant, status).sort()).toEqual([...expected].sort());
      },
    );
  });

  describe('participantOf()', () => {
    const parties = { buyerId: 'b', sellerId: 's', inspectorUserId: 'i' };

    it.each([
      ['b', 'BUYER'],
      ['s', 'SELLER'],
      ['i', 'INSPECTOR'],
    ])('o usuário %s é %s', (userId, role) => {
      expect(participantOf(parties, userId)).toBe(role);
    });

    it('devolve null para quem não participa', () => {
      expect(participantOf(parties, 'outro')).toBeNull();
    });
  });
});
