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
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: missingOperationId,
  });
}

/**
 * Toda rota declara o operationId em @ApiOperation({ operationId }) (verbo +
 * recurso em camelCase), desacoplado do nome do método. A lib chama esta
 * factory em toda rota e o valor explícito a sobrescreve; uma rota sem ele
 * fica com este sentinela, que o teste de contrato reprova.
 */
export function missingOperationId(controllerKey: string, methodKey: string): string {
  return `MISSING_OPERATION_ID_${controllerKey}_${methodKey}`;
}

/** Formato do openapi.json: 2 espaços e quebra de linha no fim. */
export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
