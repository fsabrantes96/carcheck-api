import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AppExpressAdapter } from './common/http/app-express.adapter.js';
import { BODY_SIZE_LIMIT } from './common/limits.js';

/**
 * Adapter HTTP da aplicação. Fica numa função para que o main.ts e os testes
 * e2e criem a app com o mesmo adapter (ele precisa ser escolhido na criação).
 */
export function createHttpAdapter(): AppExpressAdapter {
  return new AppExpressAdapter();
}

/**
 * Configuração da aplicação compartilhada entre o main.ts e os testes e2e.
 * O filtro global de exceções é registrado no AppModule (APP_FILTER), então
 * já vale para qualquer app criada a partir dele.
 */
export function configureApp(app: INestApplication): void {
  // Limite do corpo explícito (o mesmo padrão de 100kb do body-parser), para
  // não depender de padrão implícito. Precisa vir antes do init: o Nest só
  // registra os parsers padrão que ainda não foram registrados. Acima do
  // limite, o AllExceptionsFilter responde 413. O cast é seguro: a app é
  // sempre criada com o AppExpressAdapter (createHttpAdapter).
  const expressApp = app as NestExpressApplication;
  expressApp.useBodyParser('json', { limit: BODY_SIZE_LIMIT });
  expressApp.useBodyParser('urlencoded', { limit: BODY_SIZE_LIMIT, extended: true });

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
}

/** Cria a aplicação do jeito que ela roda em produção. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, createHttpAdapter());
  configureApp(app);
  return app;
}
