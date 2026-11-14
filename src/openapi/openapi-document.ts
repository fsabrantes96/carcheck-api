import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Documento OpenAPI da API. Uma única função para o /docs-json (configureApp)
 * e para o openapi.json versionado (src/openapi/openapi.spec.ts), então os
 * dois nunca divergem. Não depende do ambiente nem da data: o arquivo só muda
 * quando o código muda.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('CarCheck API')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Formato do openapi.json: 2 espaços e quebra de linha no fim. */
export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
