import { realpathSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    // Grafia canônica (realpath) do cwd: o resolvedor do Vite usa o realpath
    // para os pacotes de node_modules e o mocker compara o id exato. Com
    // root: './' e o cwd em c: minúsculo (Windows), vi.mock de pacote falha.
    root: realpathSync.native(process.cwd()),
    include: ['**/*.spec.ts'],
  },
});
