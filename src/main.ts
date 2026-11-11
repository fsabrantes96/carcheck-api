import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AppExpressAdapter } from './common/http/app-express.adapter.js';

async function bootstrap() {
  // Adapter próprio para os erros do body-parser chegarem intactos ao filtro.
  const app = await NestFactory.create(AppModule, new AppExpressAdapter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            
      forbidNonWhitelisted: true, 
      transform: true,            
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('CarCheck API')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

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