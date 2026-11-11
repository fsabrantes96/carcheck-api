# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CarCheck API: NestJS backend for a vehicle marketplace where a buyer can book an **inspector** (mechanic/specialist) to evaluate a car before buying. It's a personal study project focused on clean backend↔frontend contracts (DTOs + generated OpenAPI). Code comments, error messages, commit messages, and PR descriptions are written in **Portuguese (pt-BR)**.

Roadmap (README): auth, inspector profiles, and listings are done. Next up: appointment scheduling, then inspection reports/reviews, then proximity search (PostGIS). [docs/ai-tooling-plan.md](docs/ai-tooling-plan.md) lists the planned AI agents and skills, and in doing so mentions future domain concepts such as an appointment state machine, escrowed payments with commission in cents, and role-specific response DTOs.

Known risks and their status (open, accepted, resolved) live in [docs/audit.md](docs/audit.md). Read it before designing, reviewing, or testing, and update it when a change resolves or introduces a risk.

## Commands

```bash
docker compose up -d          # Postgres 16 + PostGIS on localhost:5432 (app/app, db carcheck)
npm install                   # postinstall runs `prisma generate`
npx prisma migrate dev        # apply/create migrations
npx prisma generate           # regenerate client after schema changes
npm run start:dev             # API on http://localhost:3000, Swagger at /docs, JSON at /docs-json
npm run build                 # nest build -> dist/
npm run lint                  # oxlint --type-aware (no-floating-promises is an error)
npm run format                # prettier
npm test                      # vitest unit tests (**/*.spec.ts)
npx vitest run src/listings/listings.service.spec.ts   # single file
npx vitest run -t "name of test"                        # single test by name
npm run test:e2e              # vitest with vitest.config.e2e.ts (**/*.e2e-spec.ts), boots the full AppModule
```

**Windows gotcha (port 3000):** stopping the task that ran `npm run start:dev` can leave the child Node process (`node --enable-source-maps ...\dist\main`) still listening on port 3000. If the port stays busy, find the owner with `Get-NetTCPConnection -LocalPort 3000 -State Listen` (the `OwningProcess` column), confirm it is the process you started (e.g. `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` for its command line and start time), and stop only that PID. Never kill every `node.exe`: the user may have their own `start:dev` running.

Env vars (`.env`, see `.env.example`): `DATABASE_URL`, `JWT_SECRET` (required, `getOrThrow`), `JWT_EXPIRES_IN_SECONDS` (default 3600).

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on PRs to `main`: `npm ci`, `npm run build`, `npm test`. No database service is started in CI, so unit tests must not need a live DB.

## Architecture

- **ESM + NodeNext**: `"type": "module"`. Every relative import must end in `.js` (`import { X } from './x.service.js'`). Use `import type` for type-only imports (e.g. `JwtPayload`, Prisma `Role`/`Prisma` types), since `isolatedModules` is on.
- **Prisma 7**: the schema is [prisma/schema.prisma](prisma/schema.prisma) and the CLI config (datasource URL, migrations path) is [prisma7.config.ts](prisma7.config.ts). The client is generated into `src/generated/prisma/` (gitignored) and imported from `../generated/prisma/client.js`, which also provides enums like `Role` and `ListingStatus`. `PrismaService` ([src/prisma/prisma.service.ts](src/prisma/prisma.service.ts)) extends `PrismaClient` with the `@prisma/adapter-pg` driver adapter and is exported by a `@Global()` `PrismaModule`. `prisma/prisma.module.ts` and `prisma/prisma.service.ts` are empty leftover files; the real ones are under `src/prisma/`.
- **Money** is stored as integer cents (`priceCents`, `basePriceCents`).
- **Global `ValidationPipe`** in [src/main.ts](src/main.ts) uses `whitelist`, `forbidNonWhitelisted`, and `transform`. Unknown fields are rejected, and query-string numbers need `@Type(() => Number)` (see `ListListingsQueryDto`).

### Feature module pattern (`src/<feature>/`)

`<feature>.module.ts`, `.controller.ts`, `.service.ts`, and a `dto/` folder. Follow `listings/` as the reference:

- **Request DTOs** use `class-validator` plus `@ApiProperty`. Update DTOs extend `PartialType` from `@nestjs/swagger`, not `@nestjs/mapped-types`.
- **Response DTOs** never expose Prisma entities. Each one has a `static from(entity)` mapper, and services return these DTOs. Controllers declare return types and `@ApiOkResponse`/`@ApiCreatedResponse` plus error responses (`@ApiNotFoundResponse`, `@ApiForbiddenResponse`, etc.), because the OpenAPI contract is generated from code, never written by hand.
- **Pagination** returns `{ items, total, page, limit }`, with `limit` capped (max 50), using `$transaction([findMany, count])`.
- **Ownership (404 vs 403)** depends on whether the resource is public or private (see the `ownership-check` skill):
  - **Public resource** (anyone may know it exists, e.g. listings): 404 when it doesn't exist; **403** when it exists but the caller isn't the owner. Services use a private `assertOwner(id, userId)`.
  - **Private resource** (only participants may know it exists, e.g. appointments, payments): **404** both when it doesn't exist and when the caller isn't a participant, so existence isn't leaked. A participant whose role can't perform an action gets 403.
  - Public reads filter by visibility in the `where` (e.g. `status: 'ACTIVE'`), never after fetching.

### Auth ([src/auth/](src/auth/))

- JWT payload is `{ sub: userId, email }`. `JwtAuthGuard` verifies the Bearer token and sets `request.user`. `@CurrentUser()` reads it.
- Roles (`USER`, `INSPECTOR`, `ADMIN`) live on `User.roles` (an array) and are **not** in the token. `RolesGuard` with `@Roles(...)` loads them from the DB on each request, so role changes apply right away. Use `@UseGuards(JwtAuthGuard, RolesGuard)` in that order.
- Creating an inspector profile (`POST /inspectors/me`) pushes `INSPECTOR` onto the user's roles inside the same transaction.
- **Inspector verification is manual and intentional for now.** `InspectorProfile.verified` starts as `false` and is set to `true` by hand (e.g. via `npx prisma studio`). No route sets it, and `UpdateInspectorProfileDto` deliberately excludes it. This is a product decision, not a bug: don't "fix" it by adding `verified` to a DTO or creating an endpoint unless asked. `GET /inspectors` lists only verified profiles.
- `AuthModule` exports `JwtModule`, `JwtAuthGuard`, and `RolesGuard`, so feature modules that use the guards import `AuthModule`.

## Conventions

- Branches are `feat/<name>`. Commits use Conventional Commits in Portuguese with a scope, e.g. `feat(listings): adiciona CRUD de anúncios`.
- PRs follow [.github/pull_request_template.md](.github/pull_request_template.md): "O que mudou", "Como testar", and a checklist that includes updating the README roadmap.

## Testing

- **Vitest with globals** (`describe`, `it`, `expect`, `vi` without imports). Use `vi.fn()`/`vi.spyOn`, never `jest`. Test files follow the ESM rules above (`.js` imports, `import type`).
- **Unit tests** live next to the code as `src/**/*.spec.ts` and run with `npm test`. They must not need a database (CI has none): mock `PrismaService` with `vi.fn()` only for the methods used; for `$transaction(callback)`, make the mock call the callback with the mock itself.
- **Windows gotcha:** `vi.mock('bcrypt')` does not take effect when the terminal's current directory is spelled with a lowercase drive (`c:\dev\carcheck-api`); it works with `C:\dev\carcheck-api`. If a bcrypt mock seems ignored, check the drive letter before debugging the test.
- **E2E tests** live in `test/**/*.e2e-spec.ts` and run with `npm run test:e2e`. They boot the full `AppModule`, need the Docker database, and must clean up the data they create.
- Test names are in pt-BR and describe behavior (`it('retorna 403 quando o anúncio é de outro usuário')`). One behavior per `it`; assert the exception type and message, not just "it threw".
- **Tests are the specification.** When a test fails, fix the production code. Never edit, comment out, skip (`it.skip`/`it.todo`/`it.fails`) or loosen an existing test just to make it pass; if a test looks wrong, stop and explain why.
- Before adding a case, look in the module's existing spec file and extend it instead of duplicating cases.
- Bug fixes go in two commits: `test(<scope>): ...` with the failing test, then `fix(<scope>): ...` with the fix.
