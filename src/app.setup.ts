import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AppExpressAdapter } from './common/http/app-express.adapter.js';

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
