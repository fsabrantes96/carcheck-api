import { defineConfig } from 'vitest/config';
import { e2eDatabaseUrl } from './test/support/test-database.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    // Sem segredos reais: valores só para os testes. Sobrescrevem o .env.
    env: {
      DATABASE_URL: e2eDatabaseUrl(),
      JWT_SECRET: 'segredo-apenas-para-e2e',
      JWT_EXPIRES_IN_SECONDS: '3600',
      PLATFORM_FEE_BPS: '1000',
    },
    // Os arquivos dividem o mesmo banco e limpam as tabelas: um por vez.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
