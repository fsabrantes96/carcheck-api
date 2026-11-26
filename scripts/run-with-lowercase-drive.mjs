// Roda a suíte com o cwd do projeto grafado com a letra do drive em minúsculo
// (c:\dev\carcheck-api), como a extensão do VS Code abre a pasta no Windows.
//
// Por que existe: com o cwd em c: minúsculo, o vi.mock de pacote deixava de
// valer (ver "Windows and the drive letter" no CLAUDE.md e o risco 80 do
// docs/audit.md). Para reproduzir ou conferir isso, `Set-Location 'c:\...'` no
// PowerShell não serve: ele entrega C:\ ao processo filho. Este script cria o
// processo do Vitest já com o cwd em minúsculo.
//
// Só faz sentido no Windows (não há letra de drive em outros sistemas).
//
// Os comandos são fixos: o argumento só escolhe um modo da lista abaixo; nada
// é montado a partir de argumentos ou variáveis de ambiente, e não há shell.
// Chama o Node direto com o vitest.mjs do projeto, porque o Node recusa iniciar
// npx.cmd/npm.cmd sem shell no Windows. Os modos equivalem a:
//   cwd   mostra o process.cwd() visto pelo processo filho
//   unit  npm test           (vitest run)
//   e2e   npm run test:e2e   (vitest run --config ./vitest.config.e2e.ts)
//   mock  as duas travas do vi.mock (vitest-root.spec.ts e auth.service.spec.ts)
// Uso: node scripts/run-with-lowercase-drive.mjs <cwd|unit|e2e|mock>
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.error('Só faz sentido no Windows (não há letra de drive).');
  process.exit(2);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = projectRoot[0].toLowerCase() + projectRoot.slice(1);
const vitest = join(cwd, 'node_modules', 'vitest', 'vitest.mjs');

const MODES = {
  cwd: ['-e', 'console.log(process.cwd())'],
  unit: [vitest, 'run'],
  e2e: [vitest, 'run', '--config', './vitest.config.e2e.ts'],
  mock: [
    vitest,
    'run',
    'test/support/vitest-root.spec.ts',
    'src/auth/auth.service.spec.ts',
  ],
};

const mode = process.argv[2];
if (process.argv.length !== 3 || !Object.hasOwn(MODES, mode)) {
  console.error(
    `Uso: node scripts/run-with-lowercase-drive.mjs <${Object.keys(MODES).join('|')}>`,
  );
  process.exit(2);
}

console.error(`[lowercase-drive] cwd=${cwd} modo=${mode}`);
const result = spawnSync(process.execPath, MODES[mode], {
  cwd,
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
