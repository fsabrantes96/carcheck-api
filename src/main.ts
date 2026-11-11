import { Logger } from '@nestjs/common';
import { createApp } from './app.setup.js';

async function bootstrap() {
  const app = await createApp();
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
