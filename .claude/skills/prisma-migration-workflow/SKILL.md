---
name: prisma-migration-workflow
description: Use sempre que for alterar o prisma/schema.prisma (novo model, campo, enum, índice ou relação), e também quando o código não enxergar um model/enum que já está no schema (enums.ts vazio, model ausente em models/, "Already in sync"). Passo a passo da edição ao commit, com a conferência de que o client gerado foi atualizado.
---

# Fluxo de migration (Prisma 7)

Antes de começar, leia a seção Prisma do `CLAUDE.md` (onde fica o schema, a config do CLI e o client gerado) e os riscos de dados no `docs/audit.md`.

## Passo a passo

1. **Banco no ar**: `docker compose up -d`.
2. **Editar** o `prisma/schema.prisma`. Dinheiro em centavos (`Int`), `onDelete` explícito nas relações, `@@index` para os filtros usados nas listagens.
3. **Formatar e validar**: `npx prisma format` e depois `npx prisma validate`.
4. **Criar e aplicar a migration**: `npx prisma migrate dev --name <acao_em_snake_case>` (ex.: `add_appointments`).
5. **Ler o `migration.sql` gerado** em `prisma/migrations/<timestamp>_<nome>/`. Pare e avise antes de seguir se houver:
   - `DROP TABLE` / `DROP COLUMN`;
   - coluna `NOT NULL` sem `DEFAULT` em tabela que já tem dados;
   - alteração ou remoção de valor de enum.
6. **Conferir o client gerado** em `src/generated/prisma/` (veja a seção abaixo).
7. **Compilar**: `npm run build`.
8. **Commit**: `prisma/schema.prisma` + a pasta da migration **no mesmo commit**. O `src/generated/` nunca vai para o commit (está no `.gitignore`).

Proibido sem pedir: editar uma migration já aplicada, `npx prisma migrate reset` (apaga os dados) e `npx prisma db push`.

## Conferir o client gerado

Depois do `migrate dev`, confirme que:

- `src/generated/prisma/enums.ts` contém os enums novos ou alterados;
- `src/generated/prisma/models/` tem o arquivo do model novo, com os campos novos.

## Problema conhecido: client desatualizado com o banco em dia

**Sintoma** (já aconteceu neste projeto):

- `src/generated/prisma/enums.ts` contém só o comentário `This file is empty because there are no enums in the schema`, embora o schema tenha enums;
- `src/generated/prisma/models/` não tem o model novo;
- o TypeScript reclama que o enum ou o model não existe;
- e `npx prisma migrate dev` responde **"Already in sync"**.

**Causa**: a migration já estava aplicada no banco. Quem estava desatualizado era o **client gerado**, não o banco. Por isso rodar `migrate dev` de novo não resolve nada.

**Solução**:

1. `npx prisma generate`.
2. Conferir de novo o `enums.ts` e o `models/` (seção acima).
3. Reiniciar o `npm run start:dev`, porque o watch pode continuar usando o client antigo.
4. Se o editor ainda acusar erro, no VS Code: `Ctrl+Shift+P` → **TypeScript: Restart TS Server**.

Não crie uma migration nova nem rode `migrate reset` para "consertar" esse sintoma.

## Checklist

- [ ] `format` e `validate` sem erros.
- [ ] `migration.sql` lido e sem operação destrutiva inesperada.
- [ ] `enums.ts` e `models/` atualizados.
- [ ] `npm run build` passa.
- [ ] Schema e migration no mesmo commit; nada de `src/generated/`.
