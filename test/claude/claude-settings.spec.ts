import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Especificação do .claude/settings.json e da skill ship-pr (arquivo inteiro,
// frontmatter, allowed-tools, comandos citados e frase do modo auto) (risco 57
// do docs/audit.md; no carcheck-web, risco 11).
//
// ATENÇÃO: o matcher abaixo é uma aproximação da sintaxe documentada em
// https://code.claude.com/docs/en/permissions (todo `*` casa qualquer texto,
// espaços inclusive; um ` *` final, quando é o único curinga, também casa o
// comando sem nada depois; Bash diferencia maiúsculas, PowerShell não). Ele
// NÃO é o matcher do Claude Code (que também separa subcomandos, ignora
// atribuições de variável no início etc.) e NÃO substitui o teste manual das
// regras numa sessão nova, no modo padrão e no modo auto. Os testes de
// maiúsculas descrevem o matcher, não o Claude Code: no Claude Code, `GIT` e
// `GIT.EXE` no Bash continuam sem cobertura (risco 57).
//
// O spec é uma trava: lê sempre os arquivos versionados, pelo caminho relativo
// a este arquivo, sem variável nem opção que aponte para outro. Ele lê a cópia
// de trabalho (uma edição não commitada é o que vai ser testado) e não
// considera o .claude/settings.local.json, que também afeta as permissões
// (quem o confere é o passo 2 da ship-pr, na hora de publicar). O
// .claude/settings.json tem que ser idêntico ao do front, mas este spec só
// confere a constante deste repositório: a igualdade com o front é conferida
// à mão. Os arquivos são lidos com \r\n trocado por \n, para que um checkout
// com CRLF não mude o resultado.

type Shell = 'Bash' | 'PowerShell';
const SHELLS: Shell[] = ['Bash', 'PowerShell'];

interface Settings {
  permissions: { allow?: string[]; deny: string[]; ask: string[] };
}

// SHA256 do .claude/settings.json, com \r\n trocado por \n, em maiúsculas como
// o (Get-FileHash .claude/settings.json).Hash. O arquivo precisa ser idêntico
// no carcheck-api e no carcheck-web: mudou o settings, atualize esta constante
// nos dois repositórios. Este spec só trava a constante deste repositório; a
// igualdade com o carcheck-web é conferida à mão, com o Get-FileHash nos dois.
const SETTINGS_SHA256 =
  '2308B79325D8FA7ECBC746AC58FD58E29E8B78E5A610F897E53FDD0840199AA9';

// Comandos do allowed-tools da ship-pr, os mesmos em Bash e em PowerShell.
const SHIP_PR_ALLOWED_COMMANDS = [
  'git branch --show-current',
  'gh auth status',
  'git status --porcelain',
  'git rev-parse HEAD',
  'npm run lint',
  'npx tsc --noEmit -p tsconfig.json',
  'npm test',
  'npm run test:e2e',
  'docker ps --filter "publish=5432" --format "{{.Names}} {{.Image}} {{.Status}}"',
  'git diff --no-ext-diff --no-textconv -w main...HEAD -- "*.spec.ts" "*.e2e-spec.ts"',
  'git diff --no-ext-diff --no-textconv --name-only main...HEAD',
  'git diff --no-ext-diff --no-textconv main...HEAD',
  'git log --oneline main..HEAD',
  'git grep -c "it(" main -- "*.spec.ts" "*.e2e-spec.ts"',
  'git grep -c "it(" -- "*.spec.ts" "*.e2e-spec.ts"',
  'gh pr view * --json url',
];

// Chaves de topo do frontmatter da ship-pr, em ordem alfabética.
const SHIP_PR_FRONTMATTER_KEYS = [
  'allowed-tools',
  'description',
  'disable-model-invocation',
  'name',
];

// SHA256 do frontmatter da ship-pr (o texto entre o --- da primeira linha e o
// --- de fechamento, sem eles), com \r\n trocado por \n, em maiúsculas. Fecha
// o que o parse por regex não vê (comentário na coluna 0 no meio do
// allowed-tools, chave entre aspas). É própria deste repositório: o
// allowed-tools da ship-pr do carcheck-web é outro, então o hash também.
const SHIP_PR_FRONTMATTER_SHA256 =
  'E0D0F1535A0C23B10D94125090363F7D39B93516B678F9FC59C246D7E6EC873C';

// SHA256 da SKILL.md da ship-pr inteira, com \r\n trocado por \n, em
// maiúsculas como o (Get-FileHash .claude/skills/ship-pr/SKILL.md).Hash. Trava
// o corpo da skill (regra de parada, aprovação explícita, lista do que é
// proibido, comandos em texto corrido), que as verificações por regex abaixo
// não cobrem por inteiro. É própria deste repositório: a ship-pr do
// carcheck-web é outra. A skill é editada à mão pelo usuário; atualize esta
// constante no mesmo commit.
const SHIP_PR_SKILL_SHA256 =
  '7B0FEF1F4F71C164F4687E16CD887CFBCD55EFFCC25F572F62189AC67DC06AFA';

// Frontmatter: abre na primeira linha e fecha com uma linha que é só ---.
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

const repoFile = (path: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');

const settingsText = repoFile('.claude/settings.json');
const settings = JSON.parse(settingsText) as Settings;
const { deny, ask } = settings.permissions;

const skill = repoFile('.claude/skills/ship-pr/SKILL.md');

// Devolve o frontmatter da ship-pr; sem o --- de fechamento, lança erro, e
// todo teste que depende dele falha.
function frontmatter(): string {
  const match = FRONTMATTER.exec(skill);
  if (match?.[1] === undefined) {
    throw new Error('SKILL.md da ship-pr sem frontmatter fechado por ---');
  }
  return match[1];
}

const RULE = /^(Bash|PowerShell)\((.*)\)$/s;

function shellRules(rules: string[], shell: Shell): string[] {
  return rules.flatMap((rule) => {
    const match = RULE.exec(rule);
    return match?.[1] === shell && match[2] !== undefined ? [match[2]] : [];
  });
}

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toRegExp(pattern: string, shell: Shell): RegExp {
  const flags = shell === 'PowerShell' ? 'i' : '';
  const body = pattern.split('*').map(escapeRegExp).join('[\\s\\S]*');
  const wildcards = pattern.split('*').length - 1;
  if (wildcards === 1 && pattern.endsWith(' *')) {
    const bare = escapeRegExp(pattern.slice(0, -2));
    return new RegExp(`^(?:${body}|${bare})$`, flags);
  }
  return new RegExp(`^${body}$`, flags);
}

function matching(rules: string[], shell: Shell, command: string): string[] {
  return shellRules(rules, shell).filter((pattern) =>
    toRegExp(pattern, shell).test(command),
  );
}

// Regras de shell do endurecimento das permissões que o deny precisa ter, nos
// dois shells.
const HARDENED_DENY = [
  'git push *--ta*',
  'git push *--fol*',
  'git push *tags/*',
  'git push * tag *',
  'git config*',
  'git -*',
  'git.exe*',
  'gh.exe*',
  'gh -*',
  'git remote add*',
  'git remote set-url*',
  'git remote rename*',
  'git-credential*',
  'gh auth git-credential*',
  'gh auth login*',
  'gh auth switch*',
  'gh config*',
  'gh auth status *-t*',
  'gh auth status *--show-token*',
  'git push *refs/*',
  'git push * :',
  'gh auth -*',
  'git remote * add *',
  'git remote * set-url*',
  'git remote * rename*',
  'git push * : *',
  'gh auth status -*',
  'gh auth status * -*',
];

// Regras que o deny já cobre (algumas não literalmente, por exemplo via
// `git -*`) e que não podem voltar ao ask.
const FORBIDDEN_IN_ASK = [
  'git -c *',
  'git -C * push*',
  'git --git-dir* push*',
  'git --work-tree* push*',
  'git config *',
  'git -*',
  'git --config-env*',
  'git.exe *',
  'gh.exe *',
];

// Regras de base do deny (push e credenciais), anteriores ao endurecimento.
const BASELINE_DENY = [
  'git push --mirror*',
  'git push * --mirror*',
  'git push --all*',
  'git push * --all*',
  'git push *:chore/*',
  'git credential*',
];

const EDIT_DENY = [
  'Edit(/.git/**)',
  'Edit(/.claude/settings*.json)',
  'Edit(/.claude/skills/**)',
  'Edit(/.claude/agents/**)',
  'Edit(/.claude/commands/**)',
  'Edit(~/.gitconfig)',
  'Edit(~/.config/git/**)',
  'Edit(~/.config/gh/**)',
  'Edit(~/AppData/Roaming/GitHub CLI/**)',
  'Edit(~/.claude/settings*.json)',
  'Edit(~/.claude.json)',
  'Edit(~/.claude/CLAUDE.md)',
  'Edit(~/.claude/skills/**)',
  'Edit(~/.claude/agents/**)',
  'Edit(~/.claude/commands/**)',
  'Edit(/.mcp.json)',
  'Edit(~/AppData/Roaming/Code/User/settings.json)',
  'Edit(//c/ProgramData/Git/**)',
  'Edit(/.vscode/**)',
  'Edit(~/AppData/Roaming/Code/User/profiles/**)',
  'Edit(~/.claude/plugins/**)',
];

// Regras de Edit em arquivos que executam código sem ninguém pedir: ao rodar
// npm, npx, os testes ou a aplicação (pacotes, .npmrc, o npm global), ao abrir
// ou fechar um terminal (perfis do Git Bash e do PowerShell, Windows Terminal),
// na próxima conexão ssh, ao iniciar o VS Code (extensões) ou no logon do
// Windows (risco 57, item C). Um teste por regra, para cada uma aparecer no
// relatório e na contagem.
const EXECUTABLE_EDIT_DENY = [
  'Edit(/node_modules/**)',
  'Edit(/.npmrc)',
  'Edit(~/.npmrc)',
  'Edit(~/AppData/Roaming/npm/**)',
  'Edit(~/.bashrc)',
  'Edit(~/.bash_profile)',
  'Edit(~/.bash_login)',
  'Edit(~/.profile)',
  'Edit(~/.bash_logout)',
  'Edit(~/Documents/WindowsPowerShell/**)',
  'Edit(~/Documents/PowerShell/**)',
  'Edit(~/.ssh/**)',
  'Edit(~/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/**)',
  'Edit(~/.vscode/extensions/**)',
  'Edit(//c/dev/node_modules/**)',
  'Edit(//c/node_modules/**)',
  'Edit(~/AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/**)',
];

// Regras de Edit no spec das permissões, o deste repositório (test/claude/)
// e o do carcheck-web (src/claude/): sem elas, o agente consegue enfraquecer
// o spec ou trocar as constantes de hash (risco 57, item G). Um teste por regra.
const SPEC_EDIT_DENY = ['Edit(/test/claude/**)', 'Edit(/src/claude/**)'];

const MUST_BE_DENIED = [
  'git push --tags',
  'git push origin --tags',
  'git push --follow-tags origin chore/x',
  'git push origin refs/tags/v1',
  'git push origin tag v1',
  'git push --mirror',
  'git push origin --mirror',
  'git push --all',
  'git push origin --all',
  'git push origin :chore/x',
  'git push origin --delete chore/x',
  'git config user.name',
  'git config --global alias.p push',
  'git -C . status',
  'git -c core.pager=less log',
  'git --no-pager log',
  'git --git-dir=.git push origin chore/x',
  'git.exe push origin chore/x',
  'gh.exe pr merge 1',
  // Famílias que já estavam no deny.
  'git push --force',
  'git push origin +chore/x',
  'git push origin HEAD:main',
  'git push origin "HEAD:main"',
  'gh pr merge 1',
  'gh pr -R dono/repo merge 1',
  'gh api -X PUT repos/dono/repo/pulls/1/merge',
  'gh auth token',
  'git diff --output=x main',
  'git grep -O padrao',
  // gh com flag antes do subcomando.
  'gh -R dono/repo pr merge 1',
  'gh --help=false api -X PUT repos/dono/repo/pulls/1/merge',
  // Remoto que embrulha ou desvia o push.
  'git remote add --mirror=push espelho https://example.com/x.git',
  'git remote set-url --push origin https://example.com/x.git',
  'git remote rename origin x',
  // Credenciais e configuração do gh.
  'git credential fill',
  'git-credential-manager get',
  'gh auth git-credential get',
  'gh auth login --with-token',
  'gh auth switch',
  'gh config set editor x',
  'gh auth status --show-token',
  'gh auth status --hostname github.com -t',
  // Refspecs curinga e push "matching".
  "git push origin 'refs/*'",
  "git push origin 'refs/heads/*'",
  'git push origin :',
  // Flag antes do subcomando de gh auth e de git remote.
  'gh auth --help=false token',
  'gh auth --help=false status -t',
  'gh auth --help=false login',
  'git remote -v add --mirror=push espelho https://example.com/x.git',
  'git remote --verbose set-url --push origin https://example.com/x.git',
  // Push "matching" com o dois-pontos no meio e flags curtas combinadas.
  'git push origin : chore/x',
  'gh auth status -at',
];

// Leituras que não podem cair no deny.
const MUST_NOT_BE_DENIED = [
  'gh auth status',
  'git remote -v',
  'git remote get-url origin',
];

// Um nome realista por tipo de branch, inclusive com "main" e "tag" no nome.
const BRANCHES = [
  'feat/cadastro-veiculo',
  'fix/main-menu',
  'chore/permissoes-git',
  'test/tag-filtro',
  'docs/readme',
];

const MUST_ASK = BRANCHES.flatMap((branch) => [
  `git push -u origin ${branch}`,
  `gh pr create --base main --head ${branch} --title "t" --body-file f.md`,
]);

function allowedToolsBlock(): string[] {
  const block = frontmatter().split(/^allowed-tools:\s*$/m)[1] ?? '';
  const lines = block.split('\n');
  const end = lines.findIndex((line, index) => index > 0 && /^\S/.test(line));
  return (end === -1 ? lines : lines.slice(0, end)).filter(
    (line) => line.trim() !== '',
  );
}

const ALLOWED_TOOL_LINE = /^ {2}- '(Bash|PowerShell)\((.*)\)'$/;

function allowedTools(shell: Shell): string[] {
  return allowedToolsBlock().flatMap((line) => {
    const match = ALLOWED_TOOL_LINE.exec(line);
    return match?.[1] === shell && match[2] !== undefined ? [match[2]] : [];
  });
}

// Bloco de código: abre com 3 ou mais crases ou tis e fecha com o mesmo
// caractere, comprimento maior ou igual ao da abertura e só espaços depois.
// Sem fechamento, vai até o fim do texto (como no CommonMark). A linha de
// abertura não pode ter outro caractere da cerca depois dela: para crases é a
// regra do CommonMark; para tis é mais estrito que o CommonMark (que aceita
// ~ na info string de uma cerca de tis). O recuo é [ \t]*, não \s*, para o
// marcador não atravessar linhas. Grupos: 1 cerca, 2 caractere, 3 conteúdo.
const FENCE =
  /^[ \t]*((`|~)\2{2,})(?:(?!\2)[^\n])*\n([\s\S]*?)(?:^[ \t]*\1\2*[ \t]*$|(?![\s\S]))/gm;

function codeBlockLines(text: string = skill): string[] {
  return [...text.matchAll(FENCE)].flatMap((block) =>
    (block[3] ?? '').split('\n').map((line) => line.trim()),
  );
}

function inlineCode(text: string = skill): string[] {
  const withoutBlocks = text.replace(FENCE, '');
  return [...withoutBlocks.matchAll(/`([^`\n]+)`/g)].map(
    (match) => match[1] ?? '',
  );
}

// Prompt de terminal ("$ ") no começo de um comando citado.
const PROMPT = /^\$[ \t]+/;

// Subcomandos do git que sempre produzem diff, e os que só produzem com opção.
// "git -c" (opção global, antes do subcomando) não é o -c do log: o comando
// precisa começar por "git log", "git whatchanged" ou "git stash list".
const ALWAYS_DIFF =
  /^(git (?:diff|show|format-patch|range-diff|diff-tree|stash show))(?:\s|$)/;
const DIFF_WITH_OPTION =
  /^(git (?:log|whatchanged|stash list))\s(?:.*\s)?(?:-p|-u|-c|--cc|-U\d*|--unified|--patch(?:-with-(?:stat|raw))?|--stat|--numstat|--word-diff|--color-words|-L\S*)(?:[\s=]|$)/;

const withoutPrompt = (command: string): string =>
  command.trim().replace(PROMPT, '');

// Devolve o subcomando ("git diff", "git stash show"...) se o comando produz
// diff, ou null.
function diffSubcommand(command: string): string | null {
  const text = withoutPrompt(command);
  return (ALWAYS_DIFF.exec(text) ?? DIFF_WITH_OPTION.exec(text))?.[1] ?? null;
}

const producesDiff = (command: string): boolean =>
  diffSubcommand(command) !== null;

// Opção que reativa o diff externo ou o textconv (no git vale a última opção),
// inclusive abreviada: qualquer token que comece por --text ou --ext. Pega
// também o --text (-a) do diff, que é inofensivo: erra para o lado seguro.
const REENABLES_DIFF_PROGRAM = /(?:^|\s)--(?:text|ext)/;

// O subcomando vem logo seguido de --no-ext-diff --no-textconv, e nada depois
// reativa o diff externo ou o textconv.
function hasDiffFlags(command: string): boolean {
  const text = withoutPrompt(command);
  const subcommand = diffSubcommand(text);
  if (subcommand === null) return false;
  const flagged = `${subcommand} --no-ext-diff --no-textconv`;
  if (text !== flagged && !text.startsWith(`${flagged} `)) return false;
  return !REENABLES_DIFF_PROGRAM.test(text.slice(flagged.length));
}

// Trechos inline que citam um comando de diff em texto corrido, sem ser um
// comando a rodar, com o número exato de ocorrências. Só valem com o trecho
// inteiro igual (match exato); uma ocorrência a mais falha o spec.
const INLINE_PROSE_MENTIONS: Record<string, number> = {
  'git diff': 1,
  'git diff --output': 1,
};

describe('settings.json do Claude Code', () => {
  it('tem o SHA256 fixado em SETTINGS_SHA256 (constante deste repositório; a igualdade com o carcheck-web é conferida à mão)', () => {
    expect(
      createHash('sha256').update(settingsText).digest('hex').toUpperCase(),
    ).toBe(SETTINGS_SHA256);
  });

  it('não tem regras allow', () => {
    expect(settings.permissions.allow).toBeUndefined();
  });

  it('só tem a chave permissions no topo (além de um $schema opcional), com deny e ask', () => {
    expect(Object.keys(settings).filter((key) => key !== '$schema')).toEqual([
      'permissions',
    ]);
    expect(Object.keys(settings.permissions).sort()).toEqual(['ask', 'deny']);
  });

  it('nenhuma regra termina em :*', () => {
    expect([...deny, ...ask].filter((rule) => rule.endsWith(':*)'))).toEqual(
      [],
    );
  });

  it('não tem regras duplicadas nem regra que esteja no deny e no ask', () => {
    const all = [...deny, ...ask];
    expect(all.filter((rule, index) => all.indexOf(rule) !== index)).toEqual(
      [],
    );
  });

  it.each([
    ['deny', deny],
    ['ask', ask],
  ])('toda regra de shell do %s tem o par Bash/PowerShell', (_, rules) => {
    const bash = shellRules(rules, 'Bash');
    const powershell = shellRules(rules, 'PowerShell');
    expect(bash.filter((pattern) => !powershell.includes(pattern))).toEqual([]);
    expect(powershell.filter((pattern) => !bash.includes(pattern))).toEqual([]);
  });

  it('só tem regras de Bash, PowerShell ou Edit', () => {
    expect(
      [...deny, ...ask].filter(
        (rule) => !RULE.test(rule) && !rule.startsWith('Edit('),
      ),
    ).toEqual([]);
  });

  it.each(SHELLS)(
    'em %s, tem no deny as regras endurecidas e as de base',
    (shell) => {
      const denied = shellRules(deny, shell);
      expect(
        [...HARDENED_DENY, ...BASELINE_DENY].filter(
          (pattern) => !denied.includes(pattern),
        ),
      ).toEqual([]);
    },
  );

  it.each(SHELLS)(
    'em %s, não tem no ask as regras que o deny já cobre',
    (shell) => {
      const asked = shellRules(ask, shell);
      expect(
        FORBIDDEN_IN_ASK.filter((pattern) => asked.includes(pattern)),
      ).toEqual([]);
    },
  );

  it('tem no deny as regras de Edit dos arquivos de configuração do git, do gh e do Claude Code', () => {
    expect(EDIT_DENY.filter((rule) => !deny.includes(rule))).toEqual([]);
  });

  it.each(EXECUTABLE_EDIT_DENY)(
    'tem no deny a regra %s (arquivo que executa código sem ninguém pedir)',
    (rule) => {
      expect(deny).toContain(rule);
    },
  );

  it.each(SPEC_EDIT_DENY)(
    'tem no deny a regra %s (spec das permissões, editado à mão pelo usuário)',
    (rule) => {
      expect(deny).toContain(rule);
    },
  );

  describe('matcher aproximado da sintaxe documentada', () => {
    it.each(SHELLS)(
      'em %s, push da branch e gh pr create casam com um ask e com nenhum deny',
      (shell) => {
        for (const command of MUST_ASK) {
          expect(matching(ask, shell, command), command).not.toEqual([]);
          expect(matching(deny, shell, command), command).toEqual([]);
        }
      },
    );

    it.each(SHELLS)(
      'em %s, os comandos perigosos casam com um deny',
      (shell) => {
        expect(
          MUST_BE_DENIED.filter(
            (command) => matching(deny, shell, command).length === 0,
          ),
        ).toEqual([]);
      },
    );

    it.each(SHELLS)(
      'em %s, gh auth status puro, git remote -v e git remote get-url não casam com nenhum deny',
      (shell) => {
        expect(
          MUST_NOT_BE_DENIED.filter(
            (command) => matching(deny, shell, command).length > 0,
          ),
        ).toEqual([]);
      },
    );

    it('o matcher aproximado trata o PowerShell sem diferenciar maiúsculas (GIT CONFIG casa com o deny)', () => {
      expect(matching(deny, 'PowerShell', 'GIT CONFIG user.name')).not.toEqual(
        [],
      );
    });

    it.each(SHELLS)(
      'em %s, nenhum comando do allowed-tools da ship-pr casa com um deny',
      (shell) => {
        const commands = allowedTools(shell).map((pattern) =>
          pattern.replace(/ \* /g, ' chore/x '),
        );
        expect(commands.length).toBeGreaterThan(0);
        expect(
          commands.filter(
            (command) => matching(deny, shell, command).length > 0,
          ),
        ).toEqual([]);
      },
    );

    it.each(SHELLS)(
      'em %s, nenhum comando dos blocos de código da ship-pr casa com um deny',
      (shell) => {
        const commands = codeBlockLines()
          .filter((line) => line !== '')
          .map((line) => line.replace('<branch>', 'chore/x'));
        expect(commands.length).toBeGreaterThan(0);
        expect(
          commands.filter(
            (command) => matching(deny, shell, command).length > 0,
          ),
        ).toEqual([]);
      },
    );
  });
});

describe('auto-teste do matcher aproximado (não é o matcher do Claude Code)', () => {
  it.each<[string, string, Shell, boolean]>([
    ['git push *', 'git push', 'Bash', true],
    ['git push *', 'git push origin x', 'Bash', true],
    ['git push *', 'git pushx', 'Bash', false],
    ['ls*', 'lsof', 'Bash', true],
    ['git push * -d *', 'git push origin -d', 'Bash', false],
    // Lacuna do risco 57: no Bash, GIT CONFIG e GIT.EXE em maiúsculas não
    // casam. Fica no auto-teste, sem usar o deny real, para não congelar a
    // lacuna no settings.json.
    ['git config*', 'GIT CONFIG x', 'Bash', false],
    ['git config*', 'GIT CONFIG x', 'PowerShell', true],
    ['git.exe*', 'GIT.EXE push origin chore/x', 'Bash', false],
    ['git.exe*', 'GIT.EXE push', 'PowerShell', true],
    ['a.b+c(d)*', 'a.b+c(d) x', 'Bash', true],
    ['a.b+c(d)*', 'aXb+c(d) x', 'Bash', false],
  ])(
    'a regra %j contra %j em %s casa: %s',
    (pattern, command, shell, expected) => {
      expect(toRegExp(pattern, shell).test(command)).toBe(expected);
    },
  );
});

describe('auto-teste do predicado de comandos que produzem diff', () => {
  it.each<[string, boolean]>([
    ['git diff main...HEAD', true],
    ['git show HEAD', true],
    ['git format-patch main', true],
    ['git range-diff main...HEAD', true],
    ['git diff-tree HEAD', true],
    ['git stash show', true],
    ['git log -p', true],
    ['git log -u main..HEAD', true],
    ['git log --patch', true],
    ['git log --oneline --stat main..HEAD', true],
    ['git log --stat=80', true],
    ['git log --numstat', true],
    ['git whatchanged -p', true],
    ['git log --oneline main..HEAD', false],
    ['git log --pretty=%p', false],
    ['git whatchanged --oneline', false],
    ['git difftool main', false],
    ['git grep -c "it(" main -- "*.spec.ts"', false],
    ['git status --porcelain', false],
    // -U<n>
    ['git log -U3 main..HEAD', true],
    ['git log --format=-U3', false],
    // --unified
    ['git log --unified=5', true],
    ['git log --unifiedx', false],
    // --word-diff
    ['git log --word-diff=color', true],
    ['git log --word-diffs', false],
    // --color-words
    ['git log --color-words', true],
    ['git log --color', false],
    // --cc
    ['git log --cc', true],
    ['git log --cc-x', false],
    // -c do log, que não é o -c global do git
    ['git log -c', true],
    ['git -c diff.external=x log --oneline', false],
    // -L
    ['git log -L 1,5:src/main.tsx', true],
    ['git log -L1,5:src/main.tsx', true],
    ['git log --left-right', false],
    // --patch-with-stat e --patch-with-raw
    ['git log --patch-with-stat', true],
    ['git log --patch-with-raw', true],
    ['git log --patch-with-statx', false],
    // git stash list com opção de diff
    ['git stash list -p', true],
    ['git stash list', false],
    // prefixo de prompt "$ "
    ['$ git diff main...HEAD', true],
    ['$ git status', false],
    ['$git diff main...HEAD', false],
  ])('%j produz diff: %s', (command, expected) => {
    expect(producesDiff(command)).toBe(expected);
  });

  it.each<[string, boolean]>([
    ['git diff --no-ext-diff --no-textconv main...HEAD', true],
    ['git stash show --no-ext-diff --no-textconv', true],
    ['git log --no-ext-diff --no-textconv -p', true],
    ['git stash list --no-ext-diff --no-textconv -p', true],
    ['$ git diff --no-ext-diff --no-textconv main...HEAD', true],
    ['git diff main...HEAD --no-ext-diff --no-textconv', false],
    ['git show --no-ext-diff HEAD', false],
    ['git diff --no-ext-diff --no-textconvx main', false],
    ['git log -U3', false],
    ['$ git diff main...HEAD', false],
    // Opção depois das flags que reativa o textconv ou o diff externo.
    ['git diff --no-ext-diff --no-textconv main...HEAD --textconv', false],
    ['git diff --no-ext-diff --no-textconv --textc main...HEAD', false],
    ['git log --no-ext-diff --no-textconv -p --ext-diff', false],
    ['git show --no-ext-diff --no-textconv --ext HEAD', false],
    ['git diff --no-ext-diff --no-textconv main...HEAD -- "*.text.ts"', true],
  ])('%j tem as flags logo depois do subcomando: %s', (command, expected) => {
    expect(hasDiffFlags(command)).toBe(expected);
  });
});

describe('auto-teste da leitura de blocos de código', () => {
  const blockLines = (lines: string[]): string[] =>
    codeBlockLines(lines.join('\n')).filter((line) => line !== '');

  it('lê blocos com ~~~ e com ```', () => {
    expect(
      blockLines([
        '~~~powershell',
        'git status',
        '~~~',
        '',
        '```',
        'npm test',
        '```',
      ]),
    ).toEqual(['git status', 'npm test']);
  });

  it('um bloco aberto com ``` não fecha com ~~~', () => {
    expect(blockLines(['```', 'git status', '~~~', 'npm test', '```'])).toEqual(
      ['git status', '~~~', 'npm test'],
    );
  });

  it('um bloco aberto com 4 crases não fecha com 3 crases', () => {
    expect(
      blockLines(['````md', '```', 'git diff main', '```', '````']),
    ).toEqual(['```', 'git diff main', '```']);
  });

  it('um fechamento mais longo que a abertura fecha o bloco', () => {
    const text = ['```', 'git status', '````', 'Rode `npm test`.'].join('\n');
    expect(codeBlockLines(text).filter((line) => line !== '')).toEqual([
      'git status',
    ]);
    expect(inlineCode(text)).toEqual(['npm test']);
  });

  it('uma linha de fechamento com texto depois não fecha o bloco', () => {
    expect(
      blockLines(['```', 'git status', '``` depois', 'npm test', '```']),
    ).toEqual(['git status', '``` depois', 'npm test']);
  });

  it('um bloco sem fechamento vai até o fim do texto', () => {
    const text = ['```', 'git status', '`git diff main`'].join('\n');
    expect(codeBlockLines(text).filter((line) => line !== '')).toEqual([
      'git status',
      '`git diff main`',
    ]);
    expect(inlineCode(text)).toEqual([]);
  });

  it('uma linha com crases depois da cerca de abertura não abre bloco', () => {
    expect(blockLines(['```x``` texto', 'git diff main'])).toEqual([]);
  });

  it('lê um bloco recuado dentro de um item de lista', () => {
    expect(
      blockLines([
        '1. Passo:',
        '',
        '   ```powershell',
        '   git push -u origin x',
        '   ```',
      ]),
    ).toEqual(['git push -u origin x']);
  });

  it('código inline fora dos blocos não inclui o conteúdo dos blocos', () => {
    const text = ['Rode `npm test`.', '~~~', '`git status`', '~~~'].join('\n');
    expect(inlineCode(text)).toEqual(['npm test']);
  });
});

describe('allowed-tools e comandos da skill ship-pr', () => {
  it('toda linha do allowed-tools é uma regra reconhecida, entre aspas simples e com dois espaços de recuo', () => {
    expect(
      allowedToolsBlock().filter((line) => !ALLOWED_TOOL_LINE.test(line)),
    ).toEqual([]);
  });

  it.each(SHELLS)(
    'o allowed-tools de %s é exatamente a lista SHIP_PR_ALLOWED_COMMANDS',
    (shell) => {
      expect(allowedTools(shell)).toEqual(SHIP_PR_ALLOWED_COMMANDS);
    },
  );

  it('o frontmatter abre na primeira linha e fecha com uma linha ---', () => {
    expect(FRONTMATTER.exec(skill)).not.toBeNull();
  });

  it('o frontmatter tem o SHA256 fixado em SHIP_PR_FRONTMATTER_SHA256 (constante deste repositório)', () => {
    expect(
      createHash('sha256').update(frontmatter()).digest('hex').toUpperCase(),
    ).toBe(SHIP_PR_FRONTMATTER_SHA256);
  });

  it('a SKILL.md inteira tem o SHA256 fixado em SHIP_PR_SKILL_SHA256 (constante deste repositório)', () => {
    expect(
      createHash('sha256').update(skill).digest('hex').toUpperCase(),
      'a SKILL.md da ship-pr mudou: ela é editada à mão pelo usuário, e o SHIP_PR_SKILL_SHA256 deste spec é atualizado no mesmo commit',
    ).toBe(SHIP_PR_SKILL_SHA256);
  });

  it('o frontmatter tem só as chaves esperadas, cada uma uma vez', () => {
    const keys = frontmatter()
      .split('\n')
      .flatMap((line) => /^([A-Za-z][\w-]*):/.exec(line)?.[1] ?? []);
    expect(keys.sort()).toEqual(SHIP_PR_FRONTMATTER_KEYS);
  });

  it('o frontmatter tem disable-model-invocation: true', () => {
    expect(frontmatter().split('\n')).toContain(
      'disable-model-invocation: true',
    );
  });

  it('nenhuma regra do allowed-tools termina em :*', () => {
    expect(
      [...allowedTools('Bash'), ...allowedTools('PowerShell')].filter(
        (pattern) => pattern.endsWith(':*'),
      ),
    ).toEqual([]);
  });

  it('todo * do allowed-tools vem depois de um -- ou é o nome da branch do gh pr view', () => {
    const misplaced = allowedTools('Bash').filter((pattern) => {
      if (!pattern.includes('*')) return false;
      if (pattern === 'gh pr view * --json url') return false;
      const separator = pattern.indexOf(' -- ');
      return separator === -1 || pattern.indexOf('*') < separator;
    });
    expect(misplaced).toEqual([]);
  });

  it.each(SHELLS)('em %s, tem 7 curingas no allowed-tools', (shell) => {
    const count = allowedTools(shell).join('').split('*').length - 1;
    expect(count).toBe(7);
  });

  it('todo comando que produz diff no allowed-tools usa --no-ext-diff --no-textconv', () => {
    const diffs = [
      ...allowedTools('Bash'),
      ...allowedTools('PowerShell'),
    ].filter(producesDiff);
    expect(diffs).toHaveLength(6);
    expect(diffs.filter((command) => !hasDiffFlags(command))).toEqual([]);
  });

  it('todo comando que produz diff nos blocos de código usa --no-ext-diff --no-textconv', () => {
    const diffs = codeBlockLines().filter(producesDiff);
    expect(diffs).toHaveLength(2);
    expect(diffs.filter((command) => !hasDiffFlags(command))).toEqual([]);
  });

  it('todo comando que produz diff no código inline usa --no-ext-diff --no-textconv (fora as menções em texto corrido)', () => {
    const diffs = inlineCode().filter(
      (code) =>
        producesDiff(code) &&
        !Object.keys(INLINE_PROSE_MENTIONS).includes(code),
    );
    expect(diffs).toHaveLength(1);
    expect(diffs.filter((command) => !hasDiffFlags(command))).toEqual([]);
  });

  it('as menções em texto corrido liberadas aparecem no código inline exatamente o número de vezes de INLINE_PROSE_MENTIONS', () => {
    const inline = inlineCode();
    const counts = Object.fromEntries(
      Object.keys(INLINE_PROSE_MENTIONS).map((mention) => [
        mention,
        inline.filter((code) => code === mention).length,
      ]),
    );
    expect(counts).toEqual(INLINE_PROSE_MENTIONS);
  });

  it('os blocos de código lidos incluem o push do passo 7, que fica recuado dentro de um item de lista', () => {
    expect(codeBlockLines()).toContain('git push -u origin <branch>');
  });

  it('o passo 6 cita o comando do diff por extenso', () => {
    const step6 = skill.split('### 6.')[1]?.split('### 7.')[0] ?? '';
    expect(step6).toContain(
      '`git diff --no-ext-diff --no-textconv main...HEAD`',
    );
  });

  it.each(SHELLS)(
    'todo comando dos blocos de código, exceto git push e gh pr create, está no allowed-tools de %s',
    (shell) => {
      const allowed = allowedTools(shell);
      const commands = codeBlockLines().filter(
        (line) =>
          line !== '' &&
          !line.startsWith('git push') &&
          !line.startsWith('gh pr create'),
      );
      expect(commands.length).toBeGreaterThan(0);
      expect(commands.filter((command) => !allowed.includes(command))).toEqual(
        [],
      );
    },
  );

  it('o passo 2 manda ler o .claude/settings.local.json e parar se tiver permissions.allow, permissions.defaultMode, hooks ou env', () => {
    const step2 = skill.split('### 2.')[1]?.split('### 3.')[0] ?? '';
    expect(step2).toContain(
      'O `.claude/settings.local.json` (na raiz do repositório) está no `.gitignore`, então o `git status` não o mostra, mas ele muda as permissões e o que roda nesta sessão. Leia o arquivo com a ferramenta Read, não com um comando de shell:',
    );
    expect(step2).toContain(
      '- Se ele tiver `allow` ou `defaultMode` dentro de `permissions`, ou `hooks` ou `env` na raiz, PARE, mesmo que o valor esteja vazio (`[]` ou `{}`). Mostre ao usuário só os nomes das chaves encontradas, não os valores, e devolva o controle a ele.',
    );
    expect(step2).toContain(
      '- Se ele não for um JSON válido, ou se a leitura falhar por outro motivo, PARE e diga o motivo, sem citar trechos do arquivo.',
    );
  });

  it('o passo 5 manda parar com arquivos que mudam permissões, o comportamento do agente ou o CI, esperar a confirmação explícita do usuário e pedir o SHA256 no formato de 64 hexadecimais, com o comando literal', () => {
    const step5 = skill.split('### 5.')[1]?.split('### 6.')[0] ?? '';
    for (const line of [
      'PARE também se a lista tiver um arquivo que muda as permissões, o comportamento do agente ou o que roda no CI, mesmo que a mudança pareça ser o objetivo da PR. Cada item abaixo vale em qualquer nível do repositório, na raiz ou em qualquer subpasta:',
      '- qualquer arquivo dentro de uma pasta `.claude/` ou `.agents/`;',
      '- `.mcp.json`;',
      '- qualquer arquivo dentro de `.vscode/` ou de `.github/`;',
      '- `.gitattributes`.',
      'Mostre ao usuário os arquivos desse grupo e devolva o controle a ele. Só siga para o passo 6 depois que ele responder, de forma explícita, que a mudança foi de propósito.',
      'Se entre eles houver um `settings.json` dentro de uma pasta `.claude/` ou uma `SKILL.md` dentro de `.claude/skills/ship-pr/`, em qualquer nível, a resposta precisa trazer também o SHA256 de cada um:',
      "- Para cada arquivo, mostre o comando pronto para rodar na raiz do repositório, já com o caminho real do arquivo entre aspas simples e com `-LiteralPath`. Para os arquivos da raiz, os comandos são `(Get-FileHash -LiteralPath '.claude/settings.json').Hash` e `(Get-FileHash -LiteralPath '.claude/skills/ship-pr/SKILL.md').Hash`. Se o caminho tiver aspas simples, ou se o git mostrar o caminho entre aspas, não monte o comando: mostre o caminho e peça ao usuário que calcule o hash por conta própria.",
      '- Diga ao usuário que ele compara o resultado com o hash da versão que ele revisou, não com a constante do spec nem com um valor mostrado na sessão.',
      '- Não mostre, não calcule e não sugira hash nenhum para esses arquivos, nem mesmo a constante do spec.',
      '- A resposta precisa trazer, para cada arquivo pedido, o caminho e um SHA256 de 64 caracteres hexadecimais. Se faltar o valor de algum arquivo, se um valor não tiver esse formato ou se não estiver ligado a um caminho, PARE de novo e peça só o que falta, sem sugerir valor.',
      '- Só confira a forma da resposta. Quem compara o hash é o usuário.',
      'Silêncio, "ok?" ou uma resposta sem o SHA256 pedido no formato pedido não são confirmação.',
    ]) {
      expect(step5, line).toContain(line);
    }
  });

  it('a SKILL.md não contém nenhuma sequência de 64 caracteres hexadecimais (a skill não mostra nem sugere hash)', () => {
    expect(skill.match(/[0-9A-Fa-f]{64}/g) ?? []).toEqual([]);
  });

  it('registra os dois testes do modo auto em vez de afirmar como fato que o ask é aprovado sem perguntar', () => {
    expect(skill).toContain(
      'em 2026-11-15, as regras `ask` foram aprovadas sem perguntar no modo auto; no teste de 2026-11-19 (no back) pediram permissão, como diz a documentação. Por isso esta skill deve rodar no modo padrão.',
    );
    // Os mesmos trechos proibidos do spec do front.
    for (const stale of [
      'diz o contrário',
      'no modo auto as regras `ask` são aprovadas',
    ]) {
      expect(skill, stale).not.toContain(stale);
    }
  });
});
