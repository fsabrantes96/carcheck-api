---
name: state-machine-pattern
description: Use ao modelar ou alterar um fluxo com estados (agendamento, status de anúncio, pagamento): tabela de transições, tabela de permissões por papel, função pura que decide, como o service aplica a transição com proteção contra corrida e como mapear os erros (404/403/409). Não use para CRUD sem estados. O desenho do fluxo (estados e regras) vem antes, com o agente api-architect.
---

# Máquina de estados

Antes de começar, leia o `CLAUDE.md` (regra de 404/403 e convenções) e o `docs/audit.md` (riscos de fluxo conhecidos). Os nomes de estados e ações abaixo são **exemplos**; os reais vêm do desenho aprovado.

## Duas perguntas separadas

1. **Em que estado esta ação é permitida?** → tabela `TRANSITIONS`
2. **Quem pode executá-la?** → tabela `PERMISSIONS`

"Quem" é o **papel do usuário naquele registro** (`BUYER`, `SELLER`, `INSPECTOR`), obtido com o `assertParticipant` da skill `ownership-check`. Não é a role global (`USER`/`INSPECTOR`/`ADMIN`). Ações automáticas (expirar, liberar) usam o papel `SYSTEM`.

## Onde fica

`src/<feature>/<feature>.state-machine.ts`, **sem Nest e sem Prisma**: só tipos (`import type` do enum gerado) e funções puras. Assim dá para testar todas as combinações sem mocks.

```ts
import type { AppointmentStatus as Status } from '../generated/prisma/client.js';

export type Actor = 'BUYER' | 'SELLER' | 'INSPECTOR' | 'SYSTEM';
export type Action = 'CONFIRM' | 'CANCEL' | 'COMPLETE' | 'EXPIRE';

const TRANSITIONS: Record<Action, { from: readonly Status[]; to: Status }> = {
  CONFIRM:  { from: ['REQUESTED'], to: 'CONFIRMED' },
  CANCEL:   { from: ['REQUESTED', 'CONFIRMED'], to: 'CANCELLED' },
  COMPLETE: { from: ['CONFIRMED'], to: 'COMPLETED' },
  EXPIRE:   { from: ['REQUESTED'], to: 'EXPIRED' },
};

const PERMISSIONS: Record<Action, readonly Actor[]> = {
  CONFIRM:  ['INSPECTOR'],
  CANCEL:   ['BUYER', 'INSPECTOR'],
  COMPLETE: ['INSPECTOR'],
  EXPIRE:   ['SYSTEM'],
};

export type Decision =
  | { ok: true; to: Status }
  | { ok: false; reason: 'FORBIDDEN_ACTOR' | 'INVALID_STATE' };

export function decide(actor: Actor, action: Action, current: Status): Decision {
  if (!PERMISSIONS[action].includes(actor)) return { ok: false, reason: 'FORBIDDEN_ACTOR' };
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) return { ok: false, reason: 'INVALID_STATE' };
  return { ok: true, to: rule.to };
}
```

## No service

| Situação | Resposta |
|---|---|
| Registro não existe, ou o usuário não participa (recurso privado) | 404 |
| Participante cujo papel não pode executar a ação (`FORBIDDEN_ACTOR`) | 403 |
| Ação não permitida no estado atual (`INVALID_STATE`) | 409 |
| Outra requisição mudou o estado no meio do caminho | 409 |

```ts
async confirm(id: string, userId: string) {
  const actor = await this.assertParticipant(id, userId); // 404 se não participa
  const current = await this.currentStatus(id);
  const decision = decide(actor, 'CONFIRM', current);
  if (!decision.ok) {
    throw decision.reason === 'FORBIDDEN_ACTOR'
      ? new ForbiddenException('Você não pode confirmar este agendamento')
      : new ConflictException('Ação não permitida no estado atual');
  }

  // Grava só se o estado ainda for o que foi lido (proteção contra corrida).
  const { count } = await this.prisma.appointment.updateMany({
    where: { id, status: current },
    data: { status: decision.to },
  });
  if (count === 0) {
    // Consulta de apoio: não refaz a operação, só escolhe o código de erro.
    const now = await this.prisma.appointment.findUnique({ where: { id }, select: { status: true } });
    if (!now) throw new NotFoundException('Agendamento não encontrado');
    throw new ConflictException('O agendamento mudou de estado; recarregue e tente novamente');
  }
  // ...buscar o registro e devolver o Response DTO
}
```

Quando a transição tiver efeitos colaterais (criar pagamento, cancelar outros registros), coloque o `updateMany` e os efeitos na mesma `$transaction`.

## Checklist do desenho

- [ ] Todo estado não final tem pelo menos uma saída.
- [ ] Estados finais listados explicitamente.
- [ ] Transições por tempo são ações do papel `SYSTEM` (ver jobs agendados).
- [ ] As decisões em aberto do `docs/audit.md` que tocam o fluxo estão respondidas ou registradas.

## Testes

- Matriz completa com `it.each`: **todas** as combinações `actor × action × estado`, incluindo as proibidas, testando o `decide()` puro.
- No service: 404 (não participa), 403, 409 por estado inválido e 409 por corrida (`updateMany` retornando `count: 0`).
- Delegue ao agente `test-engineer`.
