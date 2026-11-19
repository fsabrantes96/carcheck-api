import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Especificação do .claude/settings.json e do allowed-tools da skill ship-pr
// (risco 57 do docs/audit.md).
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
// considera o .claude/settings.local.json, que também afeta as permissões.

type Shell = 'Bash' | 'PowerShell';
const SHELLS: Shell[] = ['Bash', 'PowerShell'];

interface Settings {
  permissions: { allow?: string[]; deny: string[]; ask: string[] };
}

// Entradas do allowed-tools da ship-pr, por shell.
const ALLOWED_TOOLS_PER_SHELL = 16;

const repoFile = (path: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../${path}`, import.meta.url)),
    'utf8',
  );

const settings = JSON.parse(repoFile('.claude/settings.json')) as Settings;
const { deny, ask } = settings.permissions;

const skill = repoFile('.claude/skills/ship-pr/SKILL.md');

const RULE = /^(Bash|PowerShell)\((.*)\)$/s;

function shellRules(rules: string[], shell: Shell): string[] {
  return rules.flatMap((rule) => {
    const match = RULE.exec(rule);
    return match && match[1] === shell ? [match[2]] : [];
  });
}

function toRegExp(pattern: string, shell: Shell): RegExp {
  const flags = shell === 'PowerShell' ? 'i' : '';
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]*');
  const wildcards = pattern.split('*').length - 1;
  if (wildcards === 1 && pattern.endsWith(' *')) {
    const bare = pattern.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^(?:${body}|${bare})$`, flags);
  }
  return new RegExp(`^${body}$`, flags);
}

function matching(rules: string[], shell: Shell, command: string): string[] {
  return shellRules(rules, shell).filter((pattern) =>
    toRegExp(pattern, shell).test(command),
  );
}

// Regras de shell que este endurecimento acrescenta ao deny (cada uma em par).
const NEW_DENY = [
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
  'git credential*',
  'git-credential*',
  'gh auth git-credential*',
  'gh auth login*',
  'gh auth switch*',
  'gh config*',
  'gh auth status *-t*',
  'gh auth status *--show-token*',
  'git push *refs/*',
  'git push * :',
];

// Regras que saem do ask (o deny passa a cobri-las).
const REMOVED_ASK = [
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

// Push que já estava no deny e continua lá.
const KEPT_DENY = [
  'git push --mirror*',
  'git push * --mirror*',
  'git push --all*',
  'git push * --all*',
  'git push *:chore/*',
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
];

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
  const frontmatter = skill.split(/^---$/m)[1];
  const block = frontmatter.split(/^allowed-tools:\s*$/m)[1] ?? '';
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
    return match && match[1] === shell ? [match[2]] : [];
  });
}

const FENCE = /^\s*```[^\n]*\n([\s\S]*?)^\s*```/gm;

function codeBlockLines(): string[] {
  return [...skill.matchAll(FENCE)].flatMap((block) =>
    block[1].split('\n').map((line) => line.trim()),
  );
}

function inlineCode(): string[] {
  const withoutBlocks = skill.replace(FENCE, '');
  return [...withoutBlocks.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

const isDiffOfMain = (command: string): boolean =>
  command.startsWith('git diff') && command.includes('main');

describe('settings.json do Claude Code', () => {
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

  it('tem no deny, nos dois shells, as regras novas e as de push que já existiam', () => {
    for (const shell of SHELLS) {
      const denied = shellRules(deny, shell);
      expect(
        [...NEW_DENY, ...KEPT_DENY].filter(
          (pattern) => !denied.includes(pattern),
        ),
      ).toEqual([]);
    }
  });

  it('tirou do ask as regras que o deny passou a cobrir', () => {
    for (const shell of SHELLS) {
      const asked = shellRules(ask, shell);
      expect(REMOVED_ASK.filter((pattern) => asked.includes(pattern))).toEqual(
        [],
      );
    }
  });

  it('tem no deny as regras de Edit dos arquivos de configuração do git, do gh e do Claude Code', () => {
    expect(EDIT_DENY.filter((rule) => !deny.includes(rule))).toEqual([]);
  });

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

    it('o matcher aproximado trata o PowerShell sem diferenciar maiúsculas (GIT CONFIG casa com o deny)', () => {
      expect(matching(deny, 'PowerShell', 'GIT CONFIG user.name')).not.toEqual(
        [],
      );
    });

    it('o matcher aproximado diferencia maiúsculas no Bash: GIT CONFIG e GIT.EXE não casam com nenhum deny (lacuna do risco 57)', () => {
      expect(matching(deny, 'Bash', 'GIT CONFIG user.name')).toEqual([]);
      expect(matching(deny, 'Bash', 'GIT.EXE push origin chore/x')).toEqual([]);
    });

    it.each(SHELLS)(
      'em %s, nenhum comando do allowed-tools da ship-pr casa com um deny',
      (shell) => {
        const commands = allowedTools(shell).map((pattern) =>
          pattern.replace(/ \* /g, ' chore/x '),
        );
        expect(commands.length).toBeGreaterThan(0);
        const blocked = commands.filter(
          (command) => matching(deny, shell, command).length > 0,
        );
        expect(blocked).toEqual([]);
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
    ['git config*', 'GIT CONFIG x', 'Bash', false],
    ['git config*', 'GIT CONFIG x', 'PowerShell', true],
    ['a.b+c(d)*', 'a.b+c(d) x', 'Bash', true],
    ['a.b+c(d)*', 'aXb+c(d) x', 'Bash', false],
  ])(
    'a regra %j contra %j em %s casa: %s',
    (pattern, command, shell, expected) => {
      expect(toRegExp(pattern, shell).test(command)).toBe(expected);
    },
  );
});

describe('allowed-tools e comandos da skill ship-pr', () => {
  it('toda linha do allowed-tools é uma regra reconhecida, entre aspas simples e com dois espaços de recuo', () => {
    expect(
      allowedToolsBlock().filter((line) => !ALLOWED_TOOL_LINE.test(line)),
    ).toEqual([]);
  });

  it.each(SHELLS)('tem %s entradas no allowed-tools de cada shell', (shell) => {
    expect(allowedTools(shell)).toHaveLength(ALLOWED_TOOLS_PER_SHELL);
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

  it('lista os mesmos comandos em Bash e em PowerShell', () => {
    expect(allowedTools('Bash')).toEqual(allowedTools('PowerShell'));
  });

  it.each(SHELLS)('tem 7 curingas no allowed-tools de %s', (shell) => {
    const count = allowedTools(shell).join('').split('*').length - 1;
    expect(count).toBe(7);
  });

  it('todo git diff contra a main no allowed-tools usa --no-ext-diff --no-textconv', () => {
    const diffs = [
      ...allowedTools('Bash'),
      ...allowedTools('PowerShell'),
    ].filter(isDiffOfMain);
    expect(diffs).toHaveLength(6);
    expect(
      diffs.filter(
        (command) =>
          !command.startsWith('git diff --no-ext-diff --no-textconv '),
      ),
    ).toEqual([]);
  });

  it('todo git diff contra a main nos blocos de código usa --no-ext-diff --no-textconv', () => {
    const diffs = codeBlockLines().filter(isDiffOfMain);
    expect(diffs).toHaveLength(2);
    expect(
      diffs.filter(
        (command) =>
          !command.startsWith('git diff --no-ext-diff --no-textconv '),
      ),
    ).toEqual([]);
  });

  it('todo git diff contra a main no código inline usa --no-ext-diff --no-textconv', () => {
    const diffs = inlineCode().filter(isDiffOfMain);
    expect(diffs).toHaveLength(1);
    expect(
      diffs.filter(
        (command) =>
          !command.startsWith('git diff --no-ext-diff --no-textconv '),
      ),
    ).toEqual([]);
  });

  it('o passo 6 cita o comando do diff por extenso', () => {
    const step6 = skill.split('### 6.')[1].split('### 7.')[0];
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

  it('não afirma como fato que o ask é aprovado sem perguntar no modo auto', () => {
    expect(skill).toContain(
      'observado em 2026-11-15; a documentação diz o contrário',
    );
    expect(skill).not.toContain(
      'no modo auto as regras `ask` são aprovadas sem perguntar',
    );
  });
});
