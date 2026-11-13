---
name: ship-pr
description: Publica a branch atual e abre a PR no GitHub, depois de verificar branch, árvore limpa, lint, typecheck, unitários, e2e, testes removidos e arquivos sensíveis. Só roda quando o usuário digita /ship-pr.
disable-model-invocation: true
allowed-tools:
  - Bash(git status *)
  - Bash(git branch --show-current)
  - Bash(git rev-parse *)
  - Bash(git diff *)
  - Bash(git log *)
  - Bash(git grep *)
  - Bash(gh auth status *)
  - Bash(gh pr view *)
  - Bash(docker ps *)
  - Bash(npm run lint *)
  - Bash(npx tsc --noEmit *)
  - Bash(npm test *)
  - Bash(npm run test:e2e *)
  - PowerShell(git status *)
  - PowerShell(git branch --show-current)
  - PowerShell(git rev-parse *)
  - PowerShell(git diff *)
  - PowerShell(git log *)
  - PowerShell(git grep *)
  - PowerShell(gh auth status *)
  - PowerShell(gh pr view *)
  - PowerShell(docker ps *)
  - PowerShell(npm run lint *)
  - PowerShell(npx tsc --noEmit *)
  - PowerShell(npm test *)
  - PowerShell(npm run test:e2e *)
---

# /ship-pr: publicar a branch e abrir a PR

Esta skill é a **única exceção** à regra do `CLAUDE.md` de que o agente nunca altera o remoto. Ela só vale quando o usuário digita `/ship-pr`. Fora dela, a regra geral continua valendo: o agente não sugere esta skill no meio de outra tarefa e não faz push por conta própria.

O `allowed-tools` acima só tem comandos de leitura e de verificação. `git push` e `gh pr create` ficam de fora de propósito: o `.claude/settings.json` tem regras `ask` para eles, então o Claude Code pede permissão na hora, como segunda trava.

## Proibido nesta skill

- `--force`, `-f`, `--force-with-lease` ou refspec com `+` em qualquer push.
- Push para a `main`, direto ou por refspec (`HEAD:main`).
- `gh pr merge`, apagar branch remota (`--delete`, `-d`, `:<branch>`), `gh repo edit` ou qualquer mudança de configuração do repositório.
- `gh api` para qualquer coisa que escreva (POST, PATCH, PUT, DELETE).
- Esperar o CI ou fazer merge.
- Subir o container do Postgres (`docker compose up`).
- Corrigir código, testes ou commits para a verificação passar. Se algo falhar, **pare**, mostre o motivo e devolva o controle ao usuário.

## Regra de parada

Execute os passos na ordem. Se qualquer verificação falhar, **PARE**: mostre o comando, a saída relevante e o motivo, e não faça push. Não pule passos e não troque a ordem.

## Passos

### 1. Branch

```powershell
git branch --show-current
```

Precisa ser diferente de `main` e começar com `feat/`, `fix/`, `chore/`, `test/` ou `docs/`. Se não for, PARE.

Confira também `gh auth status`. Se o gh não estiver autenticado, PARE.

### 2. Árvore de trabalho limpa

```powershell
git status --porcelain
```

A saída precisa estar vazia (inclusive sem arquivos não rastreados). Se não estiver, PARE e liste os arquivos.

Anote o commit atual (`git rev-parse HEAD`). O passo 7 confere se ele não mudou.

### 3. Lint, typecheck, unitários e e2e

Rode em sequência e pare na primeira falha:

```powershell
npm run lint
npx tsc --noEmit -p tsconfig.json
npm test
```

Antes dos e2e, confira se o Postgres está de pé:

```powershell
docker ps --filter "publish=5432" --format "{{.Names}} {{.Image}} {{.Status}}"
```

Se não aparecer nenhum container `postgis/postgis` com status `Up`, **PARE e avise o usuário**. Não suba o container.

```powershell
npm run test:e2e
```

Mostre os números de cada etapa: avisos e erros do lint, erros do typecheck, arquivos e testes (passaram, falharam, pulados) dos unitários e dos e2e.

### 4. Testes removidos

```powershell
git diff -w main...HEAD -- "*.spec.ts" "*.e2e-spec.ts"
```

Liste todas as linhas removidas (começam com `-`, sem contar os cabeçalhos `---`), com o arquivo de cada uma. As únicas remoções aceitas sem parar são linhas de `import` (e as linhas em branco que vêm junto). Se houver **qualquer outra remoção** (um `it`, um `expect`, uma linha de setup, um teste trocado por `it.skip`), PARE e mostre as linhas ao usuário. Ele decide se a remoção é legítima.

### 5. Arquivos sensíveis

```powershell
git diff --name-only main...HEAD
```

Nenhum arquivo da lista pode ser sensível. PARE se aparecer:

- `.env` ou qualquer `.env.*`, **exceto** `.env.example`;
- chaves e certificados: `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`;
- arquivos de credenciais: `credentials*.json`, `*.secret*`, `.npmrc` com token.

Se um nome parecer suspeito e não estiver nesta lista, pergunte ao usuário antes de seguir.

### 6. Título e descrição: ESPERE a aprovação

Leia `git log --oneline main..HEAD`, o diff e o `docs/audit.md`, e proponha:

- **Título** em Conventional Commits pt-BR com escopo (`feat(appointments): ...`), porque ele vira a mensagem do commit do squash.
- **Descrição** seguindo `.github/pull_request_template.md` ("O que mudou", "Como testar", "Checklist"), contendo também:
  - **Testes antes x depois**: quantidade de `it(` em `*.spec.ts` e `*.e2e-spec.ts` na `main` e na branch (`git grep -c "it(" main -- "*.spec.ts" "*.e2e-spec.ts"` e o mesmo sem `main`), mais os números do passo 3;
  - **Riscos do audit**: quais itens do `docs/audit.md` a PR resolve, introduz ou altera (ou "nenhum");
  - a linha final de atribuição exigida pelo system-reminder da sessão, se houver.

Mostre os dois e **espere a aprovação explícita do usuário** ("aprovado", "pode publicar"). Silêncio, "ok?" ou um pedido de ajuste não são aprovação. Se ele pedir mudanças, mostre a nova versão e espere de novo.

### 7. Push e PR (só depois da aprovação)

1. Confira de novo que a branch é a mesma, que `git status --porcelain` está vazio e que `git rev-parse HEAD` é o commit anotado no passo 2. Se algo mudou, volte ao passo 1.
2. Confira se já existe PR para a branch: `gh pr view <branch> --json url`. Se existir, PARE e mostre o link.
3. Grave a descrição aprovada num arquivo temporário **fora do repositório** (no diretório temporário da sessão ou em `$env:TEMP`), para não sujar a árvore.
4. Publique a branch, com o nome explícito e sem nenhuma outra flag:

   ```powershell
   git push -u origin <branch>
   ```

   Se o push for rejeitado (non-fast-forward, proteção de branch, hook), PARE e mostre o erro. Nunca tente de novo com `--force`.

5. Abra a PR:

   ```powershell
   gh pr create --base main --head <branch> --title "<título aprovado>" --body-file <arquivo>
   ```

6. Apague o arquivo temporário, mesmo que o `gh pr create` tenha falhado.

### 8. Link

Mostre o link da PR que o `gh pr create` devolveu e termine. Não faça merge, não espere o CI e não acompanhe a PR.
