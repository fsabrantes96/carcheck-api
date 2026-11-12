# Desenho: agendamento de avaliações (`appointments`)

Desenho aprovado em 2026-11-11, feito com o agente `api-architect` e revisado pelo dono do projeto. As decisões da seção 9 já estão incorporadas ao texto. Riscos ligados a este desenho estão no [`docs/audit.md`](audit.md) (riscos 26 a 49). Atualizado em 2026-11-11 depois da implementação e da revisão do PR B: onde o texto original divergiu do código, vale o que está aqui.

## Resumo

O comprador pede uma avaliação presencial de um anúncio ACTIVE com um avaliador verificado. O pedido passa por aceite do avaliador, confirmação do vendedor, pagamento retido, laudo e liberação. Os valores são congelados na criação. O desenho depende de três garantias:

- **reserva dupla do horário do avaliador** barrada no banco (exclusion constraint);
- **ciclo de vida do anúncio** com regras (arquivar em vez de apagar, transições de status explícitas);
- **respostas por perfil**, em que o campo que o perfil não pode ver não existe nem no JSON nem no OpenAPI.

## 1. Escopo: três PRs

| PR / branch | Entra |
|---|---|
| **A. `feat/listing-lifecycle`** | `ARCHIVED` no enum do anúncio; `DELETE /listings/:id` arquiva; rotas `pause`, `activate` e `mark-sold` com máquina de estados; `status` sai do `PATCH`; `sellerId` e `status` saem da resposta pública; rotas do dono usam um DTO próprio com `status` |
| **B. `feat/appointments`** | Model `Appointment` e SQL das constraints, cálculo da comissão, máquina de estados, criar, listar, detalhar, aceitar, recusar, confirmar e cancelar, expiração preguiçosa nas ações, DTOs por perfil, comissão em `GET /inspectors/me`, gancho no anúncio |
| **C. `feat/appointment-expiry-job`** | `@nestjs/schedule` e job que expira os vencidos (desligável com `JOBS_ENABLED=false`) |

**Só declarado no PR B:** os estados `PAID`, `REPORT_SUBMITTED`, `DISPUTED` e `COMPLETED` existem no enum e na tabela de transições, mas nenhuma rota chega neles. `REFUNDED` não entra agora (acrescentar valor a enum é barato; remover é caro).

**Fica para depois**, em tabelas próprias com FK para `Appointment`: `Payment`, `InspectionReport` (prazo de 48h), `CheckIn` (GPS com PostGIS), disputa, no-show e histórico de eventos (`AppointmentEvent`).

## 2. Modelo de dados

### Listing (PR A)

- `ListingStatus` ganha `ARCHIVED`, que substitui a exclusão física e é **final**.
- Transições do anúncio:

| De | Ação (rota) | Para |
|---|---|---|
| `ACTIVE` | `PAUSE` (`POST /listings/:id/pause`) | `PAUSED` |
| `ACTIVE` | `MARK_SOLD` (`POST /listings/:id/mark-sold`) | `SOLD` |
| `PAUSED` | `ACTIVATE` (`POST /listings/:id/activate`) | `ACTIVE` |
| `PAUSED` | `MARK_SOLD` | `SOLD` |
| `ACTIVE`, `PAUSED`, `SOLD` | `ARCHIVE` (`DELETE /listings/:id`) | `ARCHIVED` |
| `ARCHIVED` | nenhuma | — |

- Só o dono executa. Respostas: 404 se o anúncio não existe, 403 se não é do usuário, 409 se a transição não é permitida no status atual ou se outra requisição mudou o status no meio do caminho.
- A gravação usa `updateMany` com o status lido no `where`.
- `PATCH` em anúncio arquivado responde `409 "Anúncio arquivado não pode ser alterado"`.
- Anúncio arquivado não aparece em `GET /listings`, `GET /listings/:id` nem `GET /listings/mine`.
- **PR B:** `pause`, `mark-sold` e `DELETE` (arquivar) cancelam os agendamentos `REQUESTED`, `ACCEPTED` e `AWAITING_PAYMENT` do anúncio, na mesma transação e depois do `UPDATE` do anúncio, com `endedBy = SELLER` (a ação é do vendedor; `SYSTEM` fica só para a expiração). Se houver agendamento `PAID`, respondem `409 "O anúncio tem avaliação paga em andamento; não é possível pausar, vender ou arquivar"` e nada muda (vale também para `PAUSED → SOLD/ARCHIVED`).

### Appointment (PR B)

```prisma
enum AppointmentStatus {
  REQUESTED         // comprador pediu
  ACCEPTED          // avaliador aceitou; aguarda o vendedor
  AWAITING_PAYMENT  // vendedor confirmou local e horário
  PAID              // declarado (branch de pagamento)
  REPORT_SUBMITTED  // declarado (branch de laudo)
  DISPUTED          // declarado (branch de disputa)
  COMPLETED         // declarado
  DECLINED          // final: o avaliador recusou
  CANCELLED         // final
  EXPIRED           // final
}

enum AppointmentActor {
  BUYER
  SELLER
  INSPECTOR
  SYSTEM
}

model Appointment {
  id                   String            @id @default(uuid())
  listingId            String
  listing              Listing           @relation(fields: [listingId], references: [id], onDelete: Restrict)
  buyerId              String
  buyer                User              @relation("AppointmentBuyer", fields: [buyerId], references: [id], onDelete: Restrict)
  sellerId             String            // cópia de Listing.sellerId feita na criação
  seller               User              @relation("AppointmentSeller", fields: [sellerId], references: [id], onDelete: Restrict)
  inspectorUserId      String            // User.id do avaliador (não o id do perfil)
  inspector            User              @relation("AppointmentInspector", fields: [inspectorUserId], references: [id], onDelete: Restrict)
  status               AppointmentStatus @default(REQUESTED)
  startsAt             DateTime          @db.Timestamptz(3)
  endsAt               DateTime          @db.Timestamptz(3)
  expiresAt            DateTime?         @db.Timestamptz(3)
  meetingAddress       String?           // preenchido pelo vendedor no confirm
  priceCents           Int               // congelado = InspectorProfile.basePriceCents
  platformFeeBps       Int               // congelado = PLATFORM_FEE_BPS
  platformFeeCents     Int
  inspectorPayoutCents Int
  acceptedAt           DateTime?         @db.Timestamptz(3)
  confirmedAt          DateTime?         @db.Timestamptz(3)
  endedAt              DateTime?         @db.Timestamptz(3)
  endedBy              AppointmentActor?
  createdAt            DateTime          @default(now()) @db.Timestamptz(3)
  updatedAt            DateTime          @updatedAt @db.Timestamptz(3)

  // Constraints fora do Prisma (EXCLUDE, índice único parcial, CHECKs):
  // ver prisma/migrations/<ts>_add_appointments/migration.sql
  @@index([buyerId, createdAt])
  @@index([sellerId, createdAt])
  @@index([inspectorUserId, startsAt])
  @@index([listingId, status])
  @@index([status, expiresAt])
}
```

- `User` ganha `buyerAppointments`, `sellerAppointments` e `inspectorAppointments`.
- Colunas novas em `Timestamptz` (as atuais são `TIMESTAMP(3)` sem fuso). A entrada exige ISO 8601 com `Z` ou offset.
- `inspectorUserId` guarda `User.id`: as três partes são ids de usuário, o que simplifica `assertParticipant`, CHECKs e a exclusion. A API recebe `inspectorProfileId` (o `id` de `GET /inspectors`) e o service resolve o usuário.
- `endsAt = startsAt + APPOINTMENT_DURATION_MINUTES` (fixo, padrão 60), calculado pelo servidor. A coluna permite duração por avaliador no futuro sem mudar a constraint.

### SQL acrescentado à migration

Criar com `npx prisma migrate dev --create-only`, colar no fim do `migration.sql` e depois aplicar.

```sql
-- Exclusion constraint com igualdade em TEXT precisa do btree_gist
-- (disponível na imagem postgis/postgis:16-3.4, versão 1.7; confiável desde o PG13)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Risco 9: o mesmo avaliador não pode ter dois horários ocupados sobrepostos
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_inspector_slot_excl"
  EXCLUDE USING gist (
    "inspectorUserId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" IN ('ACCEPTED', 'AWAITING_PAYMENT', 'PAID'));

-- Sem duplicado em andamento (mesmo comprador, anúncio e avaliador)
CREATE UNIQUE INDEX "Appointment_open_triplet_key"
  ON "Appointment" ("buyerId", "listingId", "inspectorUserId")
  WHERE ("status" IN ('REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT', 'PAID', 'REPORT_SUBMITTED', 'DISPUTED'));

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_distinct_parties_chk"
    CHECK ("buyerId" <> "sellerId" AND "inspectorUserId" <> "buyerId" AND "inspectorUserId" <> "sellerId"),
  ADD CONSTRAINT "Appointment_slot_chk"
    CHECK ("endsAt" > "startsAt"),
  ADD CONSTRAINT "Appointment_money_chk"
    CHECK ("priceCents" > 0
       AND "platformFeeBps" BETWEEN 0 AND 10000
       AND "platformFeeCents" >= 0
       AND "inspectorPayoutCents" >= 0
       AND "platformFeeCents" + "inspectorPayoutCents" = "priceCents"),
  ADD CONSTRAINT "Appointment_expires_chk"
    CHECK ("status" NOT IN ('REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT') OR "expiresAt" IS NOT NULL),
  ADD CONSTRAINT "Appointment_ended_chk"
    CHECK (("status" IN ('DECLINED', 'CANCELLED', 'EXPIRED')) = ("endedBy" IS NOT NULL)),
  ADD CONSTRAINT "Appointment_address_chk"
    CHECK ("status" NOT IN ('AWAITING_PAYMENT', 'PAID') OR "meetingAddress" IS NOT NULL);
```

**Estados que ocupam o horário:** `ACCEPTED`, `AWAITING_PAYMENT` e `PAID`. `REQUESTED` não ocupa (senão qualquer comprador travaria a agenda do avaliador só pedindo). Depois do laudo o horário já passou; a branch do laudo deve exigir `agora >= startsAt`. Na criação há só uma checagem branda (409); a garantia é a constraint, aplicada no aceite. `PAID` ocupa o horário **sem prazo**: nunca é expirado nem tratado como livre, mesmo com `expiresAt` preenchido (só `ACCEPTED` e `AWAITING_PAYMENT` podem vencer; constante `EXPIRING_SLOT_STATUSES`).

### Verificado no PR B (2026-11-11, Prisma 7.10.1 com `@prisma/adapter-pg`)

1. **Drift:** o Prisma ignora a exclusion constraint, o índice único parcial e os CHECKs. Com o model real, `migrate dev --create-only` depois da migration gera migration vazia, `migrate diff` (banco → schema) sai vazio e `migrate deploy` num banco vazio cria tudo. O plano B (trocar o índice parcial por outra exclusion) não foi necessário.
2. **Forma do erro 23P01:** chega como `PrismaClientKnownRequestError` com código genérico (`P2039` em query de model, `P2010` em raw) e o SQLSTATE em `meta.driverAdapterError.cause.originalCode` (sem `error.cause`). Fixture em `test/support/prisma-error-fixtures.ts`.
3. **Mapeamento do 23P01:** o service do aceite **não** captura o erro; o `AllExceptionsFilter` detecta com `isPgError(error, '23P01')` (defensivo: formato incompleto devolve `false`) e responde `409 "O agendamento mudou ou o horário não está mais disponível"`, sem logar. Outros SQLSTATE no mesmo formato (ex.: 23514, CHECK) continuam 500 e vão para o log, porque são bug. A mensagem é específica do agendamento porque hoje é a única exclusion constraint (risco 38).
4. **Pedido duplicado:** o 23505 do índice parcial chega como `P2002` com o nome do índice em `meta.driverAdapterError.cause.constraint.index`; o service o reconhece com `isUniqueViolationOn(error, APPOINTMENT_OPEN_TRIPLET_INDEX)`.

## 3. Máquina de estados

Arquivo `src/appointments/appointments.state-machine.ts`, só com funções puras (skill `state-machine-pattern`).

| De | Ação | Para | Condições extras (no service) |
|---|---|---|---|
| (nenhum) | `REQUEST` (`POST /appointments`) | `REQUESTED` | anúncio ACTIVE; avaliador `verified`; partes distintas; antecedência mínima; sem duplicado; preço mínimo |
| `REQUESTED` | `ACCEPT` | `ACCEPTED` | `expiresAt > agora`; avaliador **continua** `verified`; EXCLUDE (horário) |
| `REQUESTED` | `DECLINE` | `DECLINED` | `expiresAt > agora` |
| `ACCEPTED` | `CONFIRM` (com `meetingAddress`) | `AWAITING_PAYMENT` | `expiresAt > agora` |
| `REQUESTED`, `ACCEPTED`, `AWAITING_PAYMENT` | `CANCEL` | `CANCELLED` | nenhuma |
| `REQUESTED`, `ACCEPTED`, `AWAITING_PAYMENT` | `EXPIRE` | `EXPIRED` | `expiresAt <= agora` |
| `AWAITING_PAYMENT` | `MARK_PAID` *(declarado)* | `PAID` | webhook do provedor |
| `PAID` | `SUBMIT_REPORT` *(declarado)* | `REPORT_SUBMITTED` | `agora >= startsAt` |
| `REPORT_SUBMITTED` | `APPROVE` *(declarado)* | `COMPLETED` | nenhuma |
| `REPORT_SUBMITTED` | `OPEN_DISPUTE` *(declarado)* | `DISPUTED` | dentro de 48h |
| `REPORT_SUBMITTED` | `AUTO_RELEASE` *(declarado)* | `COMPLETED` | 48h sem resposta |

| Ação | BUYER | SELLER | INSPECTOR | SYSTEM |
|---|---|---|---|---|
| `ACCEPT` | não | não | sim | não |
| `DECLINE` | não | não | sim | não |
| `CONFIRM` | não | sim | não | não |
| `CANCEL` | sim | sim | sim | não |
| `EXPIRE` | não | não | não | sim |
| `MARK_PAID` | não | não | não | sim |
| `SUBMIT_REPORT` | não | não | sim | não |
| `APPROVE` | sim | não | não | não |
| `OPEN_DISPUTE` | sim | não | não | não |
| `AUTO_RELEASE` | não | não | não | sim |

- O avaliador pode dar `CANCEL` em `REQUESTED` (efeito igual a recusar, mas vira `CANCELLED`); o front mostra "Recusar" nesse estado.
- `CANCEL` em `PAID` proibido até existir política de reembolso.
- Finais: `COMPLETED`, `DECLINED`, `CANCELLED`, `EXPIRED`. `DISPUTED` fica sem saída até a branch de disputa (resolução por ADMIN).
- `endedBy`: quem cancelou (`BUYER`, `SELLER` ou `INSPECTOR`); `INSPECTOR` em `DECLINE`; `SELLER` quando o cancelamento vem da transição do anúncio; `SYSTEM` só em `EXPIRE`.
- Sem campo de motivo na recusa ou no cancelamento. Sem remarcação: cancela e pede de novo.
- A resposta traz `availableActions` (ações que `decide()` permite ao papel de quem chama no estado atual).

**Ordem das checagens em cada ação:**

1. `assertParticipant`: não existe ou não participa → `404 "Agendamento não encontrado"`.
2. `decide()`: papel sem permissão → `403 "Você não pode <ação> este agendamento"`; estado errado → `409 "Ação não permitida no estado atual"`.
3. Prazo vencido (`expiresAt <= agora`): grava `EXPIRED` e responde `409 "O prazo para esta ação expirou"`. **A gravação do `EXPIRED` precisa ser confirmada antes do 409**, fora de qualquer transação que o lançamento da exceção desfaria.
4. Gravação com `updateMany({ where: { id, status: atual, expiresAt: { gt: agora } } })`. `count === 0` → `409 "O agendamento mudou de estado; recarregue e tente novamente"` (sem consulta de apoio: o 404 já foi decidido no passo 1). 23P01 no aceite → sobe para o filtro global: `409 "O agendamento mudou ou o horário não está mais disponível"`.

O `ACCEPT` roda numa transação: confere `verified` no momento do aceite (`409 "Seu perfil de avaliador precisa estar verificado para aceitar"`), expira os `ACCEPTED`/`AWAITING_PAYMENT` vencidos do mesmo avaliador (nunca `PAID`) e grava.

## 4. Expiração

Horários vêm de um relógio injetável (`CLOCK`), nunca do `now()` do banco.

| Estado | `expiresAt` |
|---|---|
| `REQUESTED` | `min(agora + 24h, startsAt)` |
| `ACCEPTED` | `min(acceptedAt + 24h, startsAt)` |
| `AWAITING_PAYMENT` | `min(confirmedAt + 30min, startsAt)` |
| `PAID` | `null` (no-show depois) |
| `REPORT_SUBMITTED` | `submittedAt + 48h` (depois) |

- **Antecedência mínima:** `APPOINTMENT_MIN_NOTICE_HOURS`, padrão **24h** (substitui a regra de 1h). Horizonte máximo de 60 dias.
- **Estratégia:** preguiçosa nas ações (PR B) + job a cada minuto com um único `updateMany` condicional e idempotente (PR C). O job só faz faxina; a correção vem do `where` com `expiresAt > agora`.
- **Horário ocupado por vencido:** dentro da transação do `ACCEPT`, antes do `updateMany`, expirar os agendamentos `ACCEPTED`/`AWAITING_PAYMENT` daquele avaliador que já venceram (nunca `PAID`). A checagem branda da criação considera `PAID` sempre ocupado e ignora `ACCEPTED`/`AWAITING_PAYMENT` com `expiresAt <= agora`.
- **Prazos** são calculados por `deadlineFor(status, entradaNoEstado, startsAt)` (`src/appointments/appointment-deadlines.ts`).
- **Leitura:** `GET` não aplica a expiração preguiçosa; até o job do PR C, um agendamento vencido aparece no estado antigo (risco 37).
- **Pedidos concorrentes no mesmo horário:** quando o avaliador aceita um, os outros dão 409 se ele tentar aceitá-los e expiram sozinhos (sem recusa automática por enquanto).

## 5. Rotas e contrato

Todas com `@UseGuards(JwtAuthGuard)`, **sem `RolesGuard`** (vale o papel no agendamento, não a role global). `ParseUUIDPipe` em todo `:id`; 401 documentado em todas.

| Método e caminho | Quem | Entrada | 2xx |
|---|---|---|---|
| `POST /appointments` | autenticado (vira BUYER); limite próprio de 10/min | `CreateAppointmentDto { listingId, inspectorProfileId, startsAt }` | 201 `BuyerAppointmentResponseDto` |
| `GET /appointments` | participante | `ListAppointmentsQueryDto { as?, status?, page<=10000, limit<=50 }` | 200 paginado, `items` com `oneOf` |
| `GET /appointments/:id` | participante | — | 200 `oneOf` |
| `POST /appointments/:id/accept` | INSPECTOR | — | 200 `InspectorAppointmentResponseDto` |
| `POST /appointments/:id/decline` | INSPECTOR | — | 200 `InspectorAppointmentResponseDto` |
| `POST /appointments/:id/confirm` | SELLER | `ConfirmAppointmentDto { meetingAddress: 5..300, trim }` | 200 `SellerAppointmentResponseDto` |
| `POST /appointments/:id/cancel` | BUYER, SELLER, INSPECTOR | — | 200 `oneOf` |

O vendedor vê o pedido desde `REQUESTED`.

### Erros de `POST /appointments` (ordem de checagem)

| Caso | Código | Mensagem |
|---|---|---|
| Campo inválido ou desconhecido; `startsAt` sem fuso | 400 | "Dados inválidos" + `errors` (fuso: "startsAt precisa ter fuso horário (Z ou ±hh:mm)") |
| `startsAt` ISO 8601 que não vira data válida (ex.: semana `2030-W02-4T14:00:00Z`, dia ordinal `2030-010T14:00:00Z`) | 400 | "startsAt inválido: use data e hora no formato aaaa-mm-ddThh:mm:ss com fuso (Z ou ±hh:mm)" |
| `startsAt` antes de agora + antecedência mínima | 400 | "O agendamento precisa de pelo menos 24 horas de antecedência" (valor vindo da configuração) |
| `startsAt` além de 60 dias | 400 | "O agendamento pode ser feito com no máximo 60 dias de antecedência" |
| Anúncio não existe ou não está ACTIVE | 404 | "Anúncio não encontrado" |
| Comprador é o vendedor | 403 | "Você não pode agendar avaliação do seu próprio anúncio" |
| Avaliador não existe ou não está verificado | 404 | "Avaliador não encontrado" |
| Avaliador é o comprador | 403 | "Você não pode agendar uma avaliação consigo mesmo" |
| Avaliador é o vendedor | 409 | "Este avaliador não está disponível para este anúncio" |
| Preço do avaliador abaixo do mínimo | 409 | "Este avaliador está indisponível no momento" |
| Duplicado em andamento (checagem prévia; P2002 do índice parcial na corrida) | 409 | "Você já tem um agendamento em andamento para este anúncio com este avaliador" |
| Horário já ocupado (checagem branda) | 409 | "O avaliador não está disponível nesse horário" |

O duplicado é checado **antes** do horário: com um pedido em andamento, a resposta é sempre a mesma e não revela a agenda do avaliador.

Sem 422: 400 entrada inválida; 403 quem chama não pode; 404 recurso invisível; 409 conflito com o estado.

### DTOs de resposta por perfil

Base (sem dinheiro e **sem ids de usuário**): `id`, `status`, `myRole`, `listing { id, title, city, state }`, `inspector { profileId, name }`, `buyer { name }`, `seller { name }`, `startsAt`, `endsAt`, `expiresAt`, `meetingAddress`, `endedBy`, `availableActions`, `createdAt`.

| DTO | `myRole` | Campos extras |
|---|---|---|
| `SellerAppointmentResponseDto` | `'SELLER'` | nenhum |
| `BuyerAppointmentResponseDto` | `'BUYER'` | `priceCents` |
| `InspectorAppointmentResponseDto` | `'INSPECTOR'` | `priceCents`, `platformFeeBps`, `platformFeeCents`, `inspectorPayoutCents` |

- Cada classe tem o próprio `static from(entity)`, campo a campo, sem spread. O Inspector não estende o Buyer.
- OpenAPI: `oneOf` + `discriminator: myRole` (`@ApiExtraModels` + `getSchemaPath`) nos GETs e no `cancel`; as ações específicas de um papel devolvem tipos concretos.
- Só `GET /inspectors/me` usa `MyInspectorProfileResponseDto extends InspectorResponseDto`, com `platformFeeBps` e `estimatedPayoutCents` (via `fromOwnProfile`). `POST` e `PATCH /inspectors/me` continuam devolvendo `InspectorResponseDto`. `GET /inspectors` não muda.

## 6. Comissão

- Função pura `splitPlatformFee(priceCents, feeBps)` em `src/common/money/platform-fee.ts`, sem Nest. `RangeError` se os valores não forem inteiros seguros, `priceCents < 0` ou `feeBps` fora de 0..10000.
- Meio para cima, só com inteiros: `fee = Math.floor((priceCents * feeBps + 5000) / 10000)`; `payout = priceCents - fee`. A invariante `fee + payout = price` vale por construção.
- `PLATFORM_FEE_BPS` validado no boot (inteiro 0..10000), documentado no `.env.example`, congelado na criação.
- **Preço mínimo:** `MIN_INSPECTION_PRICE_CENTS`, padrão **5000** (R$ 50,00). Validado ao criar o perfil e, ao editar, só quando `basePriceCents` vem no corpo (`400 "O preço base precisa ser de pelo menos 5000 centavos (R$ 50,00)"`), e na criação do agendamento (409 "Este avaliador está indisponível no momento").
- Testes: casos de borda (`price` 0 e 1, `bps` 0 e 10000, empates `(1, 5000)` → 1 e `(3, 5000)` → 2) e 1.000 casos de um PRNG com seed fixa (`mulberry32` no teste, seed na mensagem de falha), conferindo invariante, limites e igualdade com uma referência em `BigInt`.

## 7. Plano de testes

- **Unitários:** matriz completa de `decide()` com `it.each` (atores × ações × estados), esperado escrito à mão; `splitPlatformFee`; `deadlineFor`; service com Prisma mockado e `CLOCK` falso (cada erro do POST, 404 para não participante, 403, 409 por estado, prazo e `count: 0`, 23P01 e P2002 → 409); chaves exatas de cada DTO por perfil.
- **E2E** (`test/appointments.e2e-spec.ts`, `resetDatabase` com `"Appointment"`, fixture `verifiedInspector`, `CLOCK` sobrescrito): fluxo feliz até `AWAITING_PAYMENT` com o `oneOf` no `/docs-json`; regras de confiança; privacidade; tempo; concorrência (dois `accept` sobrepostos, `accept` × `cancel`, dois `POST` iguais, `POST` × `pause`), sempre afirmando invariantes e nunca 500; `/inspectors/me`; gancho do anúncio.
- **Corrida criação × status do anúncio:** a criação trava o anúncio com `SELECT ... FOR SHARE`; a transição do anúncio faz o `UPDATE` do Listing antes de cancelar os agendamentos.

## 8. Ordem dos commits

**PR A, `feat/listing-lifecycle`:** desenho e riscos → `ARCHIVED` no enum → `DELETE` arquiva → rotas de transição com máquina de estados → `status` sai do `PATCH` (409 em arquivado) → `sellerId`/`status` saem da resposta pública e o dono ganha DTO próprio → e2e → documentação.

**PR B, `feat/appointments`:** comissão pura → `PLATFORM_FEE_BPS`/`MIN_INSPECTION_PRICE_CENTS` no boot → comissão em `/inspectors/me` e preço mínimo no perfil → model e migration (com a conferência de drift) → `test`/`fix` do 23P01 → máquina de estados → relógio injetável → criação → leitura → ações → gancho do anúncio → e2e de concorrência e prazos → documentação.

**PR C, `feat/appointment-expiry-job`:** dependência → job → testes do job.

## 9. Decisões tomadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Pedidos que disputam o horário quando o avaliador aceita um | Os outros dão 409 no aceite e expiram sozinhos |
| 2 | Duração do slot | Fixa, `APPOINTMENT_DURATION_MINUTES` = 60 |
| 3 | Antecedência mínima × prazos | `expiresAt = min(janela, startsAt)`; antecedência mínima configurável `APPOINTMENT_MIN_NOTICE_HOURS`, padrão 24h |
| 4 | Anúncio sai de ACTIVE com agendamento aberto | Cancela os não pagos; 409 se houver `PAID` |
| 5 | `sellerId` na resposta pública | Removido no PR A (junto com `status`, que só o DTO do dono traz) |
| 6 | Custo do provedor de pagamento | `MIN_INSPECTION_PRICE_CENTS` = 5000, validado também no perfil do avaliador |
| 7 | Papel do vendedor | Vê desde `REQUESTED`, confirma com `meetingAddress`, pode cancelar antes do pagamento; sem remarcação |
| 8 | Ciclo sem pagamento | Termina em `AWAITING_PAYMENT`; em dev, avançar pelo `prisma studio` |

**Premissas confirmadas:** `ACCEPT` exige `verified` no momento do aceite; sem campo de motivo; `ARCHIVED` é final e `SOLD` só vai para `ARCHIVED`; `PATCH` em anúncio arquivado responde 409; `POST /appointments` com limite de 10/min.
