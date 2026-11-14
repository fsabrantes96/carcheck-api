# CarCheck API

Backend de um marketplace de veículos com um diferencial: o comprador pode agendar
a avaliação do carro com um **avaliador** (mecânico/especialista) antes de fechar negócio.

> Projeto pessoal de estudo. Foco em boas práticas de contratos e DTOs entre backend e frontend.

## Perfis de usuário

- **Comprador/Vendedor**: anuncia e pesquisa veículos
- **Avaliador**: se coloca à disposição para inspecionar o veículo junto com o comprador

## Stack

- [NestJS](https://nestjs.com) (TypeScript, ESM)
- [Prisma 7](https://www.prisma.io) + PostgreSQL (PostGIS)
- Swagger/OpenAPI (contrato da API gerado a partir dos DTOs)
- Docker Compose (banco local)

## Pré-requisitos

- Node.js 20+
- Docker

## Como rodar localmente

```bash
# 1. Variáveis de ambiente
cp .env.example .env        # PowerShell: Copy-Item .env.example .env

# 2. Dependências (o postinstall gera o Prisma Client)
npm install

# 3. Banco de dados
docker compose up -d

# 4. Migrations
npx prisma migrate dev

# 5. API em modo desenvolvimento
npm run start:dev
```

A API sobe em `http://localhost:3000`.

## Documentação da API

Swagger: `http://localhost:3000/docs`
Contrato OpenAPI em JSON: `http://localhost:3000/docs-json`

O mesmo contrato fica versionado em [openapi.json](openapi.json), na raiz, para o front gerar os tipos sem subir a API. Mudou um endpoint ou um DTO? Rode `npm run openapi` e versione o arquivo junto. O CI falha se ele estiver desatualizado.

## Scripts úteis

| Comando | O que faz |
|---|---|
| `npm run start:dev` | Sobe a API com hot reload |
| `npm run build` | Compila para `dist/` |
| `npm run openapi` | Regrava o `openapi.json` a partir do código (sem servidor e sem banco) |
| `npx prisma migrate dev` | Aplica/cria migrations |
| `npx prisma generate` | Regenera o Prisma Client |
| `npx prisma studio` | Interface web para ver o banco |

## Estrutura

```
prisma/          schema e migrations
src/
├── auth/        cadastro, login, guards e roles
├── inspectors/  perfil de avaliador
├── appointments/ agendamento de avaliações (máquina de estados, respostas por perfil)
├── listings/    anúncios de veículos (CRUD, filtros e ciclo de vida)
├── prisma/      PrismaService e PrismaModule
└── generated/   Prisma Client gerado (não versionado)
```

## Convenções

- Request DTO para toda entrada, validado com `class-validator`
- Response DTO para toda saída (nunca expor a entity)
- O contrato é gerado pelo código (Swagger), nunca escrito à mão, e versionado em `openapi.json`

## Ciclo de vida do anúncio

| De | Ação | Para |
|---|---|---|
| `ACTIVE` | `POST /listings/:id/pause` | `PAUSED` |
| `PAUSED` | `POST /listings/:id/activate` | `ACTIVE` |
| `ACTIVE`, `PAUSED` | `POST /listings/:id/mark-sold` | `SOLD` |
| `ACTIVE`, `PAUSED`, `SOLD` | `DELETE /listings/:id` | `ARCHIVED` (final) |

- O `PATCH /listings/:id` não altera o status (enviar `status` responde 400) e responde 409 em anúncio arquivado.
- Anúncio arquivado não é apagado do banco, mas some de `GET /listings`, `GET /listings/:id` e `GET /listings/mine`.
- A resposta pública não traz `sellerId` nem `status`; as rotas do dono devolvem o status.

O desenho completo do agendamento, que depende destas regras, está em [docs/appointments-design.md](docs/appointments-design.md).

## Agendamento de avaliação

Fluxo desta versão (desenho completo em [docs/appointments-design.md](docs/appointments-design.md)):

| De | Ação | Para | Quem |
|---|---|---|---|
| — | `POST /appointments` | `REQUESTED` | comprador (qualquer usuário logado) |
| `REQUESTED` | `POST /appointments/:id/accept` | `ACCEPTED` | avaliador |
| `REQUESTED` | `POST /appointments/:id/decline` | `DECLINED` | avaliador |
| `ACCEPTED` | `POST /appointments/:id/confirm` (com `meetingAddress`) | `AWAITING_PAYMENT` | vendedor |
| `REQUESTED`, `ACCEPTED`, `AWAITING_PAYMENT` | `POST /appointments/:id/cancel` | `CANCELLED` | qualquer participante |

- Só sobre anúncio ACTIVE e com avaliador verificado; comprador, vendedor e avaliador são pessoas diferentes.
- Antecedência mínima de 24h e máxima de 60 dias; cada etapa tem prazo (24h para o avaliador, 24h para o vendedor, 30 min para pagar).
- O horário do avaliador fica ocupado a partir do aceite, com garantia no banco (exclusion constraint).
- Quem não participa recebe 404; o comprador vê só o preço, o avaliador vê preço, comissão e repasse, o vendedor não vê valores.
- `PAID`, `REPORT_SUBMITTED`, `DISPUTED` e `COMPLETED` já existem no banco, mas nenhuma rota chega neles ainda.
- Um job roda a cada minuto e marca como `EXPIRED` os agendamentos com prazo vencido, liberando o horário do avaliador. Desligue com `JOBS_ENABLED=false`.

Variáveis novas (ver `.env.example`): `PLATFORM_FEE_BPS` (obrigatória), `MIN_INSPECTION_PRICE_CENTS`, `APPOINTMENT_DURATION_MINUTES`, `APPOINTMENT_MIN_NOTICE_HOURS` e `JOBS_ENABLED`.

## Roadmap

- [x] Setup (NestJS + Prisma + Docker)
- [x] Cadastro de usuário
- [x] Login com JWT e guards
- [x] Perfil de avaliador
- [x] Anúncios de veículos (CRUD + filtros)
- [x] Ciclo de vida do anúncio (pausar, reativar, vender, arquivar)
- [x] Agendamento de avaliação (pedido, aceite, recusa, confirmação e cancelamento; termina em "aguardando pagamento")
- [x] Expiração automática dos prazos (job a cada minuto)
- [ ] Pagamento retido
- [ ] Laudo e avaliações
- [ ] Busca por proximidade