# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CarCheck API: NestJS backend for a vehicle marketplace where a buyer can book an **inspector** (mechanic/specialist) to evaluate a car before buying. It's a personal study project focused on clean backend↔frontend contracts (DTOs + generated OpenAPI). Code comments, error messages, commit messages, and PR descriptions are written in **Portuguese (pt-BR)**.

Roadmap (README): auth, inspector profiles, listings, the listing lifecycle, appointment scheduling up to AWAITING_PAYMENT and the expiry job (PR C) are done. Next up: payment/escrow, then inspection reports/reviews, then proximity search (PostGIS). [docs/ai-tooling-plan.md](docs/ai-tooling-plan.md) lists the planned AI agents and skills, and in doing so mentions future domain concepts such as an appointment state machine, escrowed payments with commission in cents, and role-specific response DTOs.

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
npm run test:e2e              # vitest with vitest.config.e2e.ts (test/**/*.e2e-spec.ts) against the carcheck_test database
```

**Windows gotcha (port 3000):** stopping the task that ran `npm run start:dev` can leave the child Node process (`node --enable-source-maps ...\dist\main`) still listening on port 3000. If the port stays busy, find the owner with `Get-NetTCPConnection -LocalPort 3000 -State Listen` (the `OwningProcess` column), confirm it is the process you started (e.g. `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` for its command line and start time), and stop only that PID. Never kill every `node.exe`: the user may have their own `start:dev` running.

**Installing from scratch:** `npm ci` then the e2e database (see Testing). Locally the project uses npm 12, installed globally on top of Node 24 (which bundles npm 11; check with `npm -v`). npm 12 blocks dependency install scripts that aren't in `allowScripts` in `package.json`; there, `bcrypt`, `prisma`, `@prisma/engines` and `@scarf/scarf` are denied (`false`) on purpose (risk 63 in the audit): `bcrypt` ships N-API prebuilds, the Prisma CLI downloads the schema engine on first use (so the first `prisma` command needs network or the user's engine cache), and scarf is telemetry. The project's own `postinstall` (`prisma generate`) still runs. When a new dependency with an install script appears, `npm install-scripts ls` lists it: review what the script does and approve it pinned (`npm install-scripts approve <pkg>`) or deny it, never `--dangerously-allow-all-scripts`. Never run `npm audit fix --force`.

**Before `npm ci`, `npm install`, or anything else that deletes or rewrites `node_modules`:** list the project's node processes with their command lines (`Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'carcheck-api' } | Select-Object ProcessId, CreationDate, CommandLine`). If any is running, STOP and ask the user to stop it; never kill a user's process. On Windows a running app holds native files open (e.g. `bcrypt.node`), and `npm ci` then fails with EPERM halfway through, leaving `node_modules` partly deleted.

Env vars (`.env`, see `.env.example`): `DATABASE_URL`, `JWT_SECRET` (required, `getOrThrow`), `JWT_EXPIRES_IN_SECONDS` (default 3600). Business rules are validated at boot by `validateEnv` ([src/config/env.validation.ts](src/config/env.validation.ts)) and injected with `@Inject(BUSINESS_RULES)`: `PLATFORM_FEE_BPS` (**required**, integer 0..10000), `MIN_INSPECTION_PRICE_CENTS` (default 5000, at most `INSPECTION_PRICE_MAX_CENTS` = 500000, the `basePriceCents` cap), `APPOINTMENT_DURATION_MINUTES` (default 60), `APPOINTMENT_MIN_NOTICE_HOURS` (default 24). `JOBS_ENABLED` (boolean `true`/`false`, default `true`, also validated by `validateEnv`) turns the scheduled jobs on or off: with `false`, `JobsModule` (`ScheduleModule` + the `@Cron` classes) is not loaded (`ConditionalModule.registerWhen`, read with `isJobsEnabled`). The e2e config sets `PLATFORM_FEE_BPS` and `JOBS_ENABLED=false`.

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs on PRs to `main` with Node 20: `npm ci`, `npm run lint`, `npm run build`, `npm test`, then `prisma migrate deploy` and `npm run test:e2e` against a Postgres service container. Unit tests must still not need a live DB.

## Architecture

- **ESM + NodeNext**: `"type": "module"`. Every relative import must end in `.js` (`import { X } from './x.service.js'`). Use `import type` for type-only imports (e.g. `JwtPayload`, Prisma `Role`/`Prisma` types), since `isolatedModules` is on.
- **Prisma 7**: the schema is [prisma/schema.prisma](prisma/schema.prisma) and the CLI config (datasource URL, migrations path) is [prisma7.config.ts](prisma7.config.ts). The client is generated into `src/generated/prisma/` (gitignored) and imported from `../generated/prisma/client.js`, which also provides enums like `Role` and `ListingStatus`. `PrismaService` ([src/prisma/prisma.service.ts](src/prisma/prisma.service.ts)) extends `PrismaClient` with the `@prisma/adapter-pg` driver adapter and is exported by a `@Global()` `PrismaModule`. `prisma/prisma.module.ts` and `prisma/prisma.service.ts` are empty leftover files; the real ones are under `src/prisma/`.
- **`prisma migrate dev` does not regenerate the client** in Prisma 7: run `npx prisma generate` after it (see the `prisma-migration-workflow` skill).
- **Money** is stored as integer cents (`priceCents`, `basePriceCents`).
- **Global `ValidationPipe`** in [src/main.ts](src/main.ts) uses `whitelist`, `forbidNonWhitelisted`, and `transform`. Unknown fields are rejected, and query-string numbers need `@Type(() => Number)` (see `ListListingsQueryDto`).
- **`helmet`** is the first thing in `configureApp` ([src/app.setup.ts](src/app.setup.ts)), with the default CSP for the whole API, `/docs` included, and `x-powered-by` disabled. Anything registered on Express before it (middleware, `SwaggerModule.setup`) misses the headers, so new middleware goes after it. Don't loosen the CSP globally to fix the Swagger UI; if needed, loosen it only on `/docs` (risk 58 in the audit).
- **Shutdown**: `PrismaService` calls `$disconnect` in `onApplicationShutdown` (Nest's last hook, after crons stop and HTTP closes); that is what closes the adapter-pg pool. `app.enableShutdownHooks()` lives only in `main.ts`, not in `createApp`, so the e2e don't pile up signal listeners. `app.close()` alone leaves no DB connections.
- **Transaction conflicts** (deadlock 40P01, serialization failure 40001, Prisma P2034) become 409 "Conflito ao processar, tente novamente" in the global filter, logged with `Logger.warn` (code + route pattern, no ids). Detect them with `transactionConflictCode` ([src/common/prisma/prisma-errors.ts](src/common/prisma/prisma-errors.ts)); with adapter-pg a raw query reports P2010, so match on the SQLSTATE. Don't add ad hoc retry loops around `$transaction`: the API contract is "409 = retry". `test/prisma-driver-contract.e2e-spec.ts` forces a real deadlock to pin the error format.

### Feature module pattern (`src/<feature>/`)

`<feature>.module.ts`, `.controller.ts`, `.service.ts`, and a `dto/` folder. Follow `listings/` as the reference:

- **Request DTOs** use `class-validator` plus `@ApiProperty`. Update DTOs extend `PartialType` from `@nestjs/swagger`, not `@nestjs/mapped-types`.
- **Response DTOs** never expose Prisma entities. Each one has a `static from(entity)` mapper, and services return these DTOs. Controllers declare return types and `@ApiOkResponse`/`@ApiCreatedResponse` plus error responses (`@ApiNotFoundResponse`, `@ApiForbiddenResponse`, etc.), because the OpenAPI contract is generated from code, never written by hand.
- **Input limits** live only in [src/common/limits.ts](src/common/limits.ts): every DTO string has a `@MaxLength` and every number a `@Max` (below the 32-bit `Int` of the columns, otherwise Postgres rejects it with a 500), and the same constant goes into `@ApiProperty({ maxLength, maximum })`, so the limit is in the OpenAPI contract. Never repeat the number in the DTO. The password at registration is also measured in UTF-8 bytes (`@MaxBytes`, bcrypt's 72-byte limit); login doesn't measure bytes. Arrays get `@ArrayMaxSize`; use `@UniqueArray` ([src/common/validation/](src/common/validation/)) instead of class-validator's O(n²) `@ArrayUnique`. The JSON/urlencoded body limit (100kb) is set explicitly in `configureApp`.
- **Pagination** returns `{ items, total, page, limit }`, with `limit` capped (max 50), using `$transaction([findMany, count])`. `page` is capped too (`GET /listings`: 200, so `skip` never exceeds 10,000 rows).
- **Ownership (404 vs 403)** depends on whether the resource is public or private (see the `ownership-check` skill):
  - **Public resource** (anyone may know it exists, e.g. listings): 404 when it doesn't exist; **403** when it exists but the caller isn't the owner. Services use a private `assertOwner(id, userId)`.
  - **Private resource** (only participants may know it exists, e.g. appointments, payments): **404** both when it doesn't exist and when the caller isn't a participant, so existence isn't leaked. A participant whose role can't perform an action gets 403.
  - Public reads filter by visibility in the `where` (e.g. `status: 'ACTIVE'`), never after fetching.

### Listing lifecycle ([src/listings/](src/listings/))

- Status changes only through intent routes, never through `PATCH`: `POST /listings/:id/pause` (ACTIVE→PAUSED), `/activate` (PAUSED→ACTIVE), `/mark-sold` (ACTIVE|PAUSED→SOLD) and `DELETE /listings/:id`, which **archives** (→ARCHIVED, 204) instead of deleting. `ARCHIVED` is final; `SOLD` only goes to `ARCHIVED`. The rules live in the pure function `decideListingTransition` ([src/listings/listings.state-machine.ts](src/listings/listings.state-machine.ts)), applied with `updateMany` filtered by the status that was read (409 on invalid transition or race). Never delete a listing physically.
- `UpdateListingDto` has no `status` (sending it is a 400 through the whitelist). `PATCH` on an archived listing is a 409, enforced in the `update` `where` (`status: { not: 'ARCHIVED' }`).
- Archived listings are hidden from `GET /listings`, `GET /listings/:id` and `GET /listings/mine`.
- Public responses (`ListingResponseDto`) carry neither `sellerId` nor `status`; owner routes (`POST`, `GET /mine`, `PATCH`, transitions) return `MyListingResponseDto` (public fields + `status`, still no `sellerId`).
- The appointment design that builds on this is in [docs/appointments-design.md](docs/appointments-design.md).

### Appointments ([src/appointments/](src/appointments/))

Design: [docs/appointments-design.md](docs/appointments-design.md). The flow ends at `AWAITING_PAYMENT`; `PAID`, `REPORT_SUBMITTED`, `DISPUTED` and `COMPLETED` exist in the enum and the transition table but no route reaches them.

- **Private resource**: non-participants get 404 ("Agendamento não encontrado"); a participant whose role can't act gets 403; wrong state gets 409. Only `JwtAuthGuard` (no `RolesGuard`): the role that matters is the user's role *in that appointment* (`participantOf`), not the global role.
- **State machine**: pure `decide(actor, action, status)` in [appointments.state-machine.ts](src/appointments/appointments.state-machine.ts); one route per intent (`accept`, `decline`, `confirm`, `cancel`), never a PATCH with status. Writes use `updateMany` filtered by the status read and `expiresAt > now`; `count === 0` is a 409.
- **Deadlines** come from the injectable `CLOCK` ([src/common/clock/clock.ts](src/common/clock/clock.ts)), never the DB `now()`; tests use `FakeClock` (`test/support/fake-clock.ts`). `expiresAt = min(entered state + window, startsAt)` (`deadlineFor`). An action on an expired appointment writes `EXPIRED` **outside** any transaction and then returns 409. The "due" rule (status in `EXPIRABLE_STATUSES` and `expiresAt <= now`) lives only in `isDue`/`dueWhere`/`expiredData` ([appointment-deadlines.ts](src/appointments/appointment-deadlines.ts)); reuse them, don't rewrite the comparison.
- **Expiry job**: `AppointmentExpiryCron` runs every minute and calls `AppointmentExpiryService.expireDue(clock.now())`, a single conditional, idempotent `updateMany` (never `PAID` or later). Tests call `expireDue` directly; the cron class skips overlapping runs and logs errors instead of throwing. Every API instance runs it (safe, see the design doc).
- **Double booking** is prevented in the DB by the exclusion constraint `Appointment_inspector_slot_excl` (only `ACCEPTED`, `AWAITING_PAYMENT`, `PAID` occupy the slot). Its 23P01 reaches the app as P2039/P2010 with the SQLSTATE in `meta.driverAdapterError.cause.originalCode`; `isPgError` detects it and the global filter returns 409. The partial unique index `Appointment_open_triplet_key` (`APPOINTMENT_OPEN_TRIPLET_INDEX`) blocks duplicate open requests (P2002, recognized by name with `isUniqueViolationOn`). These constraints and the CHECKs live only in the migration SQL; Prisma ignores them (drift verified). Don't drop them.
- **Money** is frozen at creation (`priceCents`, `platformFeeBps`, `platformFeeCents`, `inspectorPayoutCents`) with the pure `splitPlatformFee` ([src/common/money/platform-fee.ts](src/common/money/platform-fee.ts)): integer half-up, `fee + payout === price`.
- **Responses per role** (`myRole` discriminator, `oneOf` in OpenAPI): Seller = base (no money), Buyer = base + `priceCents`, Inspector = base + price, fee bps, fee and payout. Forbidden fields don't exist in the response. No response carries user ids.
- Creating locks the listing with `SELECT ... FOR SHARE`; listing transitions (`pause`, `mark-sold`, archive) update the listing first, then cancel open appointments with `endedBy: SELLER` (it's the seller's action; `SYSTEM` is only for expiry), or 409 if one is `PAID`.
- **Advancing state in dev** (no routes for payment/report yet): open `npx prisma studio`, edit the `Appointment` row. The CHECKs still apply: `PAID` needs `meetingAddress` set (and may have `expiresAt` null); `REQUESTED`/`ACCEPTED`/`AWAITING_PAYMENT` need `expiresAt`; `DECLINED`/`CANCELLED`/`EXPIRED` need `endedBy` (and only they may have it). To simulate an expired deadline, set `expiresAt` in the past and call any action. To let an inspector receive requests, set `InspectorProfile.verified = true` there too.

### Auth ([src/auth/](src/auth/))

- JWT payload is `{ sub: userId, email }`. `JwtAuthGuard` verifies the Bearer token and sets `request.user`. `@CurrentUser()` reads it.
- Roles (`USER`, `INSPECTOR`, `ADMIN`) live on `User.roles` (an array) and are **not** in the token. `RolesGuard` with `@Roles(...)` loads them from the DB on each request, so role changes apply right away. Use `@UseGuards(JwtAuthGuard, RolesGuard)` in that order.
- Creating an inspector profile (`POST /inspectors/me`) pushes `INSPECTOR` onto the user's roles inside the same transaction.
- **Inspector verification is manual and intentional for now.** `InspectorProfile.verified` starts as `false` and is set to `true` by hand (e.g. via `npx prisma studio`). No route sets it, and `UpdateInspectorProfileDto` deliberately excludes it. This is a product decision, not a bug: don't "fix" it by adding `verified` to a DTO or creating an endpoint unless asked. `GET /inspectors` lists only verified profiles.
- `AuthModule` exports `JwtModule`, `JwtAuthGuard`, and `RolesGuard`, so feature modules that use the guards import `AuthModule`.

## Conventions

- Branches are `<type>/<name>`, with `<type>` one of `feat`, `fix`, `chore`, `test` or `docs`. Commits use Conventional Commits in Portuguese with a scope, e.g. `feat(listings): adiciona CRUD de anúncios`.
- PRs follow [.github/pull_request_template.md](.github/pull_request_template.md): "O que mudou", "Como testar", and a checklist that includes updating the README roadmap.
- O agente nunca executa comandos que alteram o remoto, com uma única exceção: a skill /ship-pr, quando o usuário a aciona explicitamente. Merge, force push e remoção de branch remota são sempre do usuário.

## AI tooling

- Project agents live in [.claude/agents/](.claude/agents/) and skills in [.claude/skills/](.claude/skills/). The planned list is in [docs/ai-tooling-plan.md](docs/ai-tooling-plan.md).
- **`/ship-pr`** ([.claude/skills/ship-pr/SKILL.md](.claude/skills/ship-pr/SKILL.md)) is the only skill allowed to change the remote: it pushes the current branch and opens the PR with `gh`, after checking the branch name, a clean tree, lint, typecheck, unit and e2e tests, removed test lines and sensitive files, and after the user explicitly approves the title and description. It has `disable-model-invocation: true`: only the user starts it by typing `/ship-pr`. The agent never runs it on its own initiative and never suggests it in the middle of another task. Its `allowed-tools` lists only read/verification commands; `git push` and `gh pr create` are deliberately left out, so each one still triggers a permission prompt.
- **[.claude/settings.json](.claude/settings.json)** (versioned) holds permission rules: `deny` for force push, push to `main`, deleting remote branches, `gh pr merge` and `gh repo edit`; `ask` for `git push` and `gh pr create`. Each rule exists as both `Bash(...)` and `PowerShell(...)`. These rules are an **extra lock, not a security boundary**: they match the command text, so other spellings (e.g. `git -C . push`, `git -c ... push`, a `+branch` refspec, `git push origin :branch`) are not caught. The rule above in Conventions is what governs; never rely on the settings alone, and never try to work around them.

## Testing

- **Vitest with globals** (`describe`, `it`, `expect`, `vi` without imports). Use `vi.fn()`/`vi.spyOn`, never `jest`. Test files follow the ESM rules above (`.js` imports, `import type`).
- **Unit tests** live next to the code as `src/**/*.spec.ts` and run with `npm test`. They must not need a database (CI has none): mock `PrismaService` with `vi.fn()` only for the methods used; for `$transaction(callback)`, make the mock call the callback with the mock itself.
- **Windows gotcha:** `vi.mock('bcrypt')` does not take effect when the terminal's current directory is spelled with a lowercase drive (`c:\dev\carcheck-api`); it works with `C:\dev\carcheck-api`. If a bcrypt mock seems ignored, check the drive letter before debugging the test.
- **E2E tests** live in `test/**/*.e2e-spec.ts` and run with `npm run test:e2e`. They boot the full `AppModule` against a **separate database, `carcheck_test`**, never the dev database `carcheck`:
  - Create it once: `docker compose exec -T db psql -U app -d carcheck -c "CREATE DATABASE carcheck_test"`. The global setup (`test/support/global-setup.ts`) refuses any URL whose database is `carcheck` or does not end in `_test`, then runs `prisma migrate deploy` on it.
  - `vitest.config.e2e.ts` sets `DATABASE_URL` (override with `E2E_DATABASE_URL`) and a test-only `JWT_SECRET`, and runs one file at a time because the files share the database.
  - Create the app with `createTestApp()` from `test/support/test-app.ts` (same adapter and `configureApp()` as `src/main.ts`; throttler limits raised 1000x unless `realThrottler: true`). Call `resetDatabase(app)` in `beforeEach` and `closeTestApp(app)` in `afterAll` (it is just `app.close()`; the Prisma connections close in `onApplicationShutdown`). Shared helpers live in `test/support/fixtures.ts`.
  - CI runs them against a Postgres service container, after the unit tests.
- Test names are in pt-BR and describe behavior (`it('retorna 403 quando o anúncio é de outro usuário')`). One behavior per `it`; assert the exception type and message, not just "it threw".
- **Tests are the specification.** When a test fails, fix the production code. Never edit, comment out, skip (`it.skip`/`it.todo`/`it.fails`) or loosen an existing test just to make it pass; if a test looks wrong, stop and explain why.
- Before adding a case, look in the module's existing spec file and extend it instead of duplicating cases.
- Bug fixes go in two commits: `test(<scope>): ...` with the failing test, then `fix(<scope>): ...` with the fix.
