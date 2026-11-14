import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AppExpressAdapter } from './common/http/app-express.adapter.js';
import { BODY_SIZE_LIMIT } from './common/limits.js';
import { buildOpenApiDocument } from './openapi/openapi-document.js';

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
  // O cast é seguro: a app é sempre criada com o AppExpressAdapter
  // (createHttpAdapter).
  const expressApp = app as NestExpressApplication;

  // Cabeçalhos de segurança em toda a API, com a CSP padrão do helmet, sem
  // exceção para /docs: o Swagger UI servido pelo Nest só carrega scripts da
  // mesma origem (nenhum inline) e a CSP padrão já permite os <style> inline.
  // Precisa vir primeiro: o app.use e o SwaggerModule.setup registram no
  // Express na ordem das chamadas, e o que vier antes fica sem os cabeçalhos.
  // O helmet também remove o X-Powered-By; o disable evita que ele seja gerado.
  expressApp.disable('x-powered-by');
  app.use(helmet());

  // Limite do corpo explícito (o mesmo padrão de 100kb do body-parser), para
  // não depender de padrão implícito. Precisa vir antes do init: o Nest só
  // registra os parsers padrão que ainda não foram registrados. Acima do
  // limite, o AllExceptionsFilter responde 413.
  expressApp.useBodyParser('json', { limit: BODY_SIZE_LIMIT });
  expressApp.useBodyParser('urlencoded', {
    limit: BODY_SIZE_LIMIT,
    extended: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // O mesmo documento do openapi.json versionado (buildOpenApiDocument).
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
}

/** Cria a aplicação do jeito que ela roda em produção. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, createHttpAdapter());
  configureApp(app);
  return app;
}
