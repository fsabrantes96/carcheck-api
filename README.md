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

## Scripts úteis

| Comando | O que faz |
|---|---|
| `npm run start:dev` | Sobe a API com hot reload |
| `npm run build` | Compila para `dist/` |
| `npx prisma migrate dev` | Aplica/cria migrations |
| `npx prisma generate` | Regenera o Prisma Client |
| `npx prisma studio` | Interface web para ver o banco |

## Estrutura

```
prisma/          schema e migrations
src/
├── auth/        cadastro, login, guards e roles
├── inspectors/  perfil de avaliador
├── listings/    anúncios de veículos (CRUD, filtros e ciclo de vida)
├── prisma/      PrismaService e PrismaModule
└── generated/   Prisma Client gerado (não versionado)
```

## Convenções

- Request DTO para toda entrada, validado com `class-validator`
- Response DTO para toda saída (nunca expor a entity)
- O contrato é gerado pelo código (Swagger), nunca escrito à mão

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

## Roadmap

- [x] Setup (NestJS + Prisma + Docker)
- [x] Cadastro de usuário
- [x] Login com JWT e guards
- [x] Perfil de avaliador
- [x] Anúncios de veículos (CRUD + filtros)
- [x] Ciclo de vida do anúncio (pausar, reativar, vender, arquivar)
- [ ] Agendamento de avaliação
- [ ] Laudo e avaliações
- [ ] Busca por proximidade