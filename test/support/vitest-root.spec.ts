import { realpathSync } from 'node:fs';

// O vi.mock de pacote só vale quando o caminho dos arquivos de teste usa a
// grafia canônica do sistema de arquivos (no Windows, a letra do drive como o
// realpath devolve). Veja o comentário do root no vitest.config.ts.
function slash(path: string): string {
  return path.replace(/\\/g, '/');
}

describe('root do Vitest', () => {
  it('resolve os arquivos de teste pela grafia canônica do caminho (realpath)', () => {
    const testPath = expect.getState().testPath;
    expect(testPath, 'expect.getState().testPath veio vazio').toBeDefined();

    expect(slash(testPath!)).toBe(slash(realpathSync.native(testPath!)));
  });
});
