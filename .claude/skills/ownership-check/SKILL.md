---
name: ownership-check
description: Use em toda rota que lê ou altera um registro que pertence a um usuário (anúncio, perfil) ou a vários participantes (agendamento, pagamento). Define quando responder 404 e quando 403 conforme o recurso seja público ou privado, os helpers assertOwner/assertParticipant, a escrita filtrada pelo dono com updateMany e como filtrar listagens.
---

# Ownership: 404 ou 403?

Antes de tudo, leia a regra de ownership no `CLAUDE.md` (ela prevalece sobre este arquivo) e os riscos relacionados no `docs/audit.md`.

## A regra

Primeiro classifique o recurso:

| Tipo | Exemplo | Não existe | Existe, mas o usuário não é dono/participante | Participante sem permissão para a ação |
|---|---|---|---|---|
| **Público** (qualquer um pode saber que existe) | anúncio | 404 | **403** | n/a |
| **Privado** (só participantes podem saber que existe) | agendamento, pagamento | 404 | **404** (não revela a existência) | 403 |

Na dúvida se um recurso é público ou privado, pergunte antes de implementar.

## Recurso público: `assertOwner`

Referência: `assertOwner` em `src/listings/listings.service.ts`.

```ts
private async assertOwner(id: string, userId: string): Promise<void> {
  const listing = await this.prisma.listing.findUnique({
    where: { id },
    select: { sellerId: true }, // só o campo de dono, nunca a entidade inteira
  });
  if (!listing) throw new NotFoundException('Anúncio não encontrado');
  if (listing.sellerId !== userId) {
    throw new ForbiddenException('Este anúncio não pertence a você');
  }
}
```

## Recurso privado: `assertParticipant`

Retorna o **papel** do usuário naquele registro. Esse papel alimenta o `decide()` da skill `state-machine-pattern`. Quem não participa recebe 404 com a mesma mensagem de "não encontrado".

```ts
// Exemplo ilustrativo: os campos reais vêm do prisma/schema.prisma.
type Participant = 'BUYER' | 'INSPECTOR' | 'SELLER';

private async assertParticipant(id: string, userId: string): Promise<Participant> {
  const appt = await this.prisma.appointment.findUnique({
    where: { id },
    select: { buyerId: true, inspectorUserId: true, sellerId: true },
  });
  const role = appt && participantOf(appt, userId); // null se não participa
  if (!role) throw new NotFoundException('Agendamento não encontrado');
  return role;
}
```

## Escrita filtrada pelo dono (`updateMany`/`deleteMany`)

Fazer `assertOwner` e depois `update({ where: { id } })` em duas etapas abre uma corrida: o registro pode sumir entre as duas, e o erro do Prisma vira 500. Quando possível, filtre pelo dono na própria escrita e, se nada for alterado, faça uma **consulta de apoio só para escolher o código de erro**:

```ts
const { count } = await this.prisma.listing.updateMany({
  where: { id, sellerId: userId },
  data,
});
if (count === 0) {
  // Consulta de apoio: não refaz a operação, só decide entre 404 e 403.
  const exists = await this.prisma.listing.findUnique({ where: { id }, select: { id: true } });
  throw exists
    ? new ForbiddenException('Este anúncio não pertence a você') // público
    : new NotFoundException('Anúncio não encontrado');
}
```

Num recurso **privado**, a consulta de apoio responde 404 tanto para "não existe" quanto para "não participa".

Limitações do `updateMany`: não aceita escrita aninhada (`vehicle: { update }`) nem `include`, e não devolve o registro. Para responder com o DTO, busque o registro depois. Se a escrita aninhada for necessária, use `assertOwner` + `update` e confira no `docs/audit.md` como os erros do Prisma estão sendo tratados.

## Listagens

- Listagem pública: filtre a visibilidade no `where` (ex.: `status: 'ACTIVE'`), nunca depois de buscar.
- "Meus" registros e recursos privados: o `where` sempre inclui o usuário (`sellerId: userId`, ou `OR` com os campos de participante). Nunca liste e depois filtre em memória.

## Checklist da rota

- [ ] Recurso classificado como público ou privado.
- [ ] `ParseUUIDPipe` no `:id`.
- [ ] Swagger: `@ApiNotFoundResponse` e, quando aplicável, `@ApiForbiddenResponse`.
- [ ] Testes: não existe, não é dono/participante (403 ou 404, conforme a tabela), participante sem permissão (privado) e sucesso.
