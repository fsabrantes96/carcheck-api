import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Especificação do .claude/settings.json e do allowed-tools da skill ship-pr
// (risco 57 do docs/audit.md).
//
// ATENÇÃO: o matcher abaixo é uma aproximação da sintaxe documentada em
// https://code.claude.com/docs/en/permissions (todo `*` casa qualquer texto,
// espaços inclusive; um ` *` final, quando é o único curinga, também casa o
// comando sem nada depois; Bash diferencia maiúsculas, PowerShell não). Ele
// NÃO é o matcher do Claude Code (que também separa subcomandos, ignora
// atribuições de variável no início etc.) e NÃO substitui o teste manual das
// regras numa sessão nova, no modo padrão e no modo auto.
//
// CLAUDE_SETTINGS_FILE aponta para outro arquivo de settings (por exemplo,
// uma cópia temporária com mudanças propostas); sem ela, vale o versionado.

type Shell = 'Bash' | 'PowerShell';
const SHELLS: Shell[] = ['Bash', 'PowerShell'];

interface Settings {
  permissions: { allow?: string[]; deny: string[]; ask: string[] };
}

const settingsPath = resolve(
  process.env.CLAUDE_SETTINGS_FILE ?? '.claude/settings.json',
);
const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Settings;
const { deny, ask } = settings.permissions;

const skill = readFileSync(resolve('.claude/skills/ship-pr/SKILL.md'), 'utf8');

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
];

const MUST_ASK = [
  'git push -u origin chore/x',
  'gh pr create --base main --head chore/x --title "t" --body-file f.md',
];

function allowedTools(shell: Shell): string[] {
  const frontmatter = skill.split(/^---$/m)[1];
  return [...frontmatter.matchAll(/^ {2}- '(Bash|PowerShell)\((.*)\)'$/gm)]
    .filter((match) => match[1] === shell)
    .map((match) => match[2]);
}

function codeBlockLines(): string[] {
  return [...skill.matchAll(/^\s*```\w*\n([\s\S]*?)^\s*```/gm)].flatMap(
    (block) => block[1].split('\n').map((line) => line.trim()),
  );
}

function inlineCode(): string[] {
  const withoutBlocks = skill.replace(/^\s*```\w*\n[\s\S]*?^\s*```/gm, '');
  return [...withoutBlocks.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

const isDiffOfMain = (command: string): boolean =>
  command.startsWith('git diff') && command.includes('main');

describe('settings.json do Claude Code', () => {
  it('não tem regras allow', () => {
    expect(settings.permissions.allow).toBeUndefined();
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

    it('em PowerShell, o deny não diferencia maiúsculas (GIT CONFIG)', () => {
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
        const blocked = commands.filter(
          (command) => matching(deny, shell, command).length > 0,
        );
        expect(blocked).toEqual([]);
      },
    );
  });
});

describe('allowed-tools e comandos da skill ship-pr', () => {
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

  it('todo comando dos blocos de código que lê o repositório está no allowed-tools', () => {
    const allowed = allowedTools('PowerShell');
    const reads = codeBlockLines().filter((line) =>
      /^git (diff|status|branch|log|grep|rev-parse)\b/.test(line),
    );
    expect(reads.filter((command) => !allowed.includes(command))).toEqual([]);
  });
});
