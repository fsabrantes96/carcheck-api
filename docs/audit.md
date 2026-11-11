# Auditoria: riscos conhecidos

Lista viva dos riscos encontrados na auditoria de 2026-11-10 (branch `main` em `a7775fe`).
Agentes e pessoas devem ler este arquivo junto com o `CLAUDE.md` para saber o estado atual do projeto.

## Como manter

- Ao resolver um risco, mude o status para **RESOLVIDO**, cite o commit ou PR e a data.
- Quando um risco for uma decisão consciente de não mexer agora, use **ACEITO** e explique o motivo.
- Riscos novos entram no fim da tabela com o próximo número. Não renumere.

Legenda: **ABERTO** (ainda existe) · **ACEITO** (decisão consciente, não é bug) · **RESOLVIDO**

## Riscos

| # | Risco | Área | Status | Evidência / observação |
|---|---|---|---|---|
| 1 | Corrida "verifica e depois cria" vira erro 500. Duas requisições simultâneas passam pelo `findUnique` e a segunda estoura P2002 no `create`. Não existe filtro global que traduza erros do Prisma (P2002 → 409, P2025 → 404, P2003 → 409). | Segurança / API | RESOLVIDO (2026-11-10) | Branch `feat/error-handling`: `32ab01e` adiciona o filtro global (P2002/P2003 → 409, P2025 → 404, resto → 500 genérico), coberto por `cfbe546`; corrida reproduzida em `d14c21a`/`080556a` e corrigida em `6a73ef5` (`AuthService.register`) e `a64dc47` (`InspectorsService.create`), que traduzem P2002 em 409 com a mesma mensagem da checagem prévia |
| 2 | E-mail não é normalizado: `Maria@x.com` e `maria@x.com` viram contas diferentes. | Segurança / dados | RESOLVIDO (2026-11-10) | Branch `feat/error-handling`: reproduzido em `78e25dc` e corrigido em `f9d49f6` (`@Transform` com `trim` + `toLowerCase` em `RegisterDto` e `LoginDto`). Dados existentes não foram alterados, ver risco 15 |
| 3 | Sem rate limit em `/auth/login` e `/auth/register`: abre força bruta e gasto de CPU com bcrypt. | Segurança | RESOLVIDO (2026-11-10) | Branch `feat/error-handling`: `933d04f` adiciona `@nestjs/throttler` (global 100/min, login e cadastro 5/min por IP), coberto por `67e14f9`. Limitações registradas no risco 14 |
| 4 | Verificação de avaliadores. Qualquer usuário vira `INSPECTOR` ao criar o perfil, e `verified` só muda manualmente. | Regras do fluxo | ACEITO (verificação manual) / ABERTO para agendamentos | A verificação manual é intencional, ver `CLAUDE.md` (seção Auth). Continua aberto: o futuro agendamento precisa exigir `verified = true` do avaliador |
| 5 | Não há testes reais: o CI verde só prova que o build passa e que `GET /` responde. | Testes | ABERTO | Único spec: `src/app.controller.spec.ts` |
| 6 | O CI não roda lint, e o lint já falha (`no-floating-promises` em `bootstrap()`). | CI / qualidade | RESOLVIDO (2026-11-10) | Resolvido na branch `chore/hygiene`: `f5ce9a0` corrige o lint em `src/main.ts` e `25c9720` adiciona `npm run lint` ao `.github/workflows/ci.yml` |
| 7 | `DELETE /listings/:id` é exclusão física. Quando um model novo tiver FK para `Listing`, o delete vai falhar com P2003 (500) ou apagar o histórico em cascata. | Regras do fluxo / dados | ABERTO | `ListingsService.remove` |
| 8 | `Listing.status` muda livremente via `PATCH` (ACTIVE ↔ SOLD ↔ PAUSED), sem regras de transição. Conflita com agendamentos em aberto. | Regras do fluxo | ABERTO | `UpdateListingDto` aceita `status` |
| 9 | Regras do agendamento indefinidas: reserva dupla do mesmo horário, conflito de interesse (comprador = vendedor, avaliador = vendedor), agendamento em anúncio não ACTIVE, expiração e no-show. | Regras do fluxo | ABERTO | Módulo de agendamento ainda não existe |
| 10 | Segredos e contrato: `JWT_SECRET` duplicado no `.env.example`; `getOrThrow` só checa presença, não força do segredo; sem refresh/revogação de token; `GET /inspectors` sem paginação; `sellerId` exposto na resposta pública do anúncio. | Segurança / contrato | ABERTO | `.env.example`, `AuthModule`, `InspectorsService.findAllVerified`, `ListingResponseDto` |
| 11 | `@Roles()` vazio em um método anula o `@Roles(...)` da classe: o `RolesGuard` usa `getAllAndOverride`, recebe `[]` do método e libera a rota para qualquer usuário autenticado. Hoje nenhuma rota faz isso, mas é uma armadilha silenciosa. | Segurança / auth | ABERTO | `src/auth/roles.guard.ts`. Encontrado pelo test-engineer ao testar o guard (branch `tmp/test-engineer-demo`). Decidir se `@Roles()` vazio deve ser proibido ou tratado como "herda da classe" |
| 12 | As proibições dos agentes (ex.: o test-engineer não pode dar `git push`, `reset`, `--amend`) são só instruções em texto. Não há regras `deny` em `.claude/settings.json` que as bloqueiem tecnicamente. | Ferramentas de IA | ACEITO (por ora) | `.claude/agents/test-engineer.md`. Decisão de 2026-11-10: aceitar o risco enquanto os agentes são usados de forma supervisionada; reavaliar se passarem a rodar sem acompanhamento |
| 13 | Risco BAIXO. Spread de DTO direto no Prisma: `{ ...dto, userId }` em `InspectorsService.create` e `{ ...vehicle }` (e `...data`) em `ListingsService.create`/`update`. Qualquer campo que for adicionado ao DTO no futuro chega ao Prisma sem passar por um mapeamento explícito. | Segurança / contrato | RESOLVIDO (2026-11-10) | Branch `feat/error-handling`: `6edf67a` troca os spreads por mapeamento campo a campo em `InspectorsService.create` e `ListingsService.create`/`update`; comportamento fixado antes pelos testes de caracterização `dddab9d` e `2c9fc52` |
| 14 | Risco BAIXO. O rate limit (`@nestjs/throttler`) conta só por IP: não há limite por conta, então um ataque distribuído (muitos IPs) contra um mesmo e-mail não é barrado. Atrás de proxy/load balancer, sem configurar `trust proxy` no Express, todos os clientes aparecem com o IP do proxy e dividem o mesmo limite (ou, mal configurado, o IP pode ser forjado via `X-Forwarded-For`). | Segurança | ABERTO | `src/common/throttler/throttler.config.ts`, `src/app.module.ts`. Global 100/min; `POST /auth/login` e `/auth/register` 5/min. Revisar `trust proxy` e limite por conta quando houver hospedagem |
| 15 | Contas antigas com maiúsculas no e-mail (ex.: `Maria@x.com`, criadas antes da normalização) não conseguem mais entrar: o `LoginDto` agora converte o e-mail para minúsculas e a busca no banco é exata. Também podem coexistir com uma conta nova `maria@x.com`. | Dados / auth | ABERTO | Introduzido por `f9d49f6`. Os dados não foram migrados de propósito. Antes de produção, contar com `SELECT count(*) FROM "User" WHERE email <> lower(trim(email))` e decidir: migrar (resolvendo duplicatas) ou buscar com `mode: 'insensitive'` |

## Decisões pendentes

- Skills da Prisma em `.claude/skills/` (12): algumas não se aplicam a este projeto, que usa PostgreSQL (ex.: `prisma-mongodb-upgrade`). Decidir depois se ficam ou saem.
