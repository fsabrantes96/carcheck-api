import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Config só do spec das permissões, usada pelo passo isolado do CI (risco 57,
// item G). É independente de propósito: não importa nem estende o
// vitest.config.ts e não tem setupFiles, para que um exclude, um include, um
// alias ou um setup posto na config dos unitários não tire o spec do CI nem
// rode código do projeto antes dele. O globals é do próprio Vitest (o spec usa
// describe, it e expect sem importar). O root é a raiz do repositório,
// calculada a partir deste arquivo, e não o cwd.
export default defineConfig({
  test: {
    globals: true,
    root: realpathSync.native(
      fileURLToPath(new URL('../../', import.meta.url)),
    ),
    include: ['test/claude/claude-settings.spec.ts'],
  },
});
