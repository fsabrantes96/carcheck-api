import { Logger } from '@nestjs/common';
import { createApp } from './app.setup.js';

async function bootstrap() {
  const app = await createApp();
  // Nos sinais de encerramento (SIGTERM, SIGINT etc.) o Nest roda o app.close(), e o PrismaService fecha as
  // conexões do banco no onApplicationShutdown. Fica só aqui (não no
  // createApp): nos e2e cada app registraria listeners de sinal no processo.
  app.enableShutdownHooks();
  await app.listen(3000);
}

// Se a aplicação não subir (banco fora do ar, variável de ambiente faltando,
// porta ocupada), registra o erro e encerra com código 1 para quem a iniciou
// (terminal, Docker, CI) perceber a falha.
bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'Falha ao iniciar a aplicação',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
