import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { closeTestApp, createTestApp } from './support/test-app.js';

type Schema = Record<string, unknown> & {
  properties?: Record<string, Schema>;
  items?: Schema;
};
type Param = { name: string; in: string; schema: Schema };
type Response = { description: string; content?: Record<string, { schema: Schema }> };
type Operation = {
  parameters?: Param[];
  requestBody?: unknown;
  security?: unknown[];
  responses: Record<string, Response>;
};
type Doc = {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};

const ERROR_REF = { $ref: '#/components/schemas/ErrorResponseDto' };

/** Todas as operações do documento, como "MÉTODO /caminho". */
function operations(doc: Doc): [string, Operation][] {
  return Object.entries(doc.paths).flatMap(([path, ops]) =>
    Object.entries(ops).map(
      ([method, op]) => [`${method.toUpperCase()} ${path}`, op] as [string, Operation],
    ),
  );
}

function errorSchema(op: Operation, status: string): Schema | undefined {
  return op.responses[status]?.content?.['application/json']?.schema;
}

/** Percorre schemas aninhados (properties, items, allOf...) e devolve os que casam. */
function findSchemas(node: unknown, match: (s: Schema) => boolean, found: Schema[] = []): Schema[] {
  if (Array.isArray(node)) {
    for (const item of node) findSchemas(item, match, found);
  } else if (node && typeof node === 'object') {
    if (match(node as Schema)) found.push(node as Schema);
    for (const value of Object.values(node)) findSchemas(value, match, found);
  }
  return found;
}

describe('Contrato OpenAPI (e2e)', () => {
  let app: INestApplication<App>;
  let doc: Doc;

  beforeAll(async () => {
    app = await createTestApp();
    doc = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body as Doc;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  const op = (method: string, path: string) => doc.paths[path][method];

  it('o /docs-json é igual ao openapi.json versionado na raiz do repositório', () => {
    const versioned = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    ) as Doc;

    expect(doc).toEqual(versioned);
  });

  describe('erros que valem para toda rota', () => {
    it('toda operação documenta 429 (limite global do throttler) e 500, no formato de erro', () => {
      for (const [name, operation] of operations(doc)) {
        expect({ name, schema: errorSchema(operation, '429') }).toEqual({ name, schema: ERROR_REF });
        expect({ name, schema: errorSchema(operation, '500') }).toEqual({ name, schema: ERROR_REF });
      }
    });

    it('toda operação com corpo documenta 400, 413 e 415, no formato de erro', () => {
      const withBody = operations(doc).filter(([, operation]) => operation.requestBody);
      expect(withBody.length).toBeGreaterThan(0);

      for (const [name, operation] of withBody) {
        for (const status of ['400', '413', '415']) {
          expect({ name, status, schema: errorSchema(operation, status) }).toEqual({
            name,
            status,
            schema: ERROR_REF,
          });
        }
      }
    });

    it('toda operação autenticada documenta 401', () => {
      const secured = operations(doc).filter(([, operation]) => operation.security);
      expect(secured.length).toBeGreaterThan(0);

      for (const [name, operation] of secured) {
        expect({ name, schema: errorSchema(operation, '401') }).toEqual({ name, schema: ERROR_REF });
      }
    });

    it('todo parâmetro {id} é uuid e a operação documenta o 400 de id inválido', () => {
      const withId = operations(doc).filter(([name]) => name.includes('{id}'));
      expect(withId.length).toBeGreaterThan(0);

      for (const [name, operation] of withId) {
        const id = operation.parameters?.find((p) => p.name === 'id' && p.in === 'path');
        expect({ name, schema: id?.schema }).toEqual({
          name,
          schema: { type: 'string', format: 'uuid' },
        });
        expect({ name, schema: errorSchema(operation, '400') }).toEqual({ name, schema: ERROR_REF });
      }
    });
  });

  describe('rotas', () => {
    it('GET / fica fora do contrato', () => {
      expect(doc.paths).not.toHaveProperty('/');
    });

    it.each([
      ['post', '/auth/register'],
      ['post', '/auth/login'],
      ['get', '/listings'],
      ['post', '/listings'],
      ['get', '/listings/mine'],
    ])('%s %s documenta o 400 de validação', (method, path) => {
      expect(errorSchema(op(method, path), '400')).toEqual(ERROR_REF);
    });

    it('GET /auth/me documenta o 404 de usuário inexistente', () => {
      expect(errorSchema(op('get', '/auth/me'), '404')).toEqual(ERROR_REF);
      expect(op('get', '/auth/me').responses['404'].description).toContain('Usuário não encontrado');
    });

    it.each([
      ['post', '/appointments/{id}/decline'],
      ['post', '/appointments/{id}/confirm'],
      ['post', '/appointments/{id}/cancel'],
    ])('%s %s (um único updateMany, sem transação) não cita conflito de transação no 409', (method, path) => {
      expect(op(method, path).responses['409'].description).not.toContain('Conflito ao processar');
    });

    it.each(['get', 'patch'])(
      '%s /inspectors/me documenta no 401 a conta que não existe mais (RolesGuard)',
      (method) => {
        expect(op(method, '/inspectors/me').responses['401'].description).toContain(
          'conta que não existe mais',
        );
      },
    );

    it.each(['get', 'patch'])(
      '%s /inspectors/me documenta o 403 com a mensagem do RolesGuard',
      (method) => {
        expect(op(method, '/inspectors/me').responses['403'].description).toContain(
          'Sem permissão para esta ação',
        );
      },
    );

    it.each([
      ['post', '/inspectors/me'],
      ['delete', '/listings/{id}'],
      ['post', '/listings/{id}/pause'],
      ['post', '/listings/{id}/activate'],
      ['post', '/listings/{id}/mark-sold'],
      ['post', '/appointments'],
      ['post', '/appointments/{id}/accept'],
    ])('%s %s (com transação) cita no 409 o conflito de transação (repetir a requisição)', (method, path) => {
      expect(op(method, path).responses['409'].description).toContain(
        'Conflito ao processar, tente novamente',
      );
    });
  });

  describe('schemas', () => {
    it('nenhum schema nem parâmetro usa type number: a API só tem inteiros', () => {
      const numbers = findSchemas(doc, (s) => s.type === 'number');

      expect(numbers).toEqual([]);
    });

    it('todo schema com format uuid ou date-time é type string', () => {
      const wrong = findSchemas(
        doc,
        (s) => (s.format === 'uuid' || s.format === 'date-time') && s.type !== 'string',
      );

      expect(wrong).toEqual([]);
    });

    it('nenhuma propriedade é um objeto sem estrutura (type object sem properties, allOf ou oneOf)', () => {
      const shapeless = findSchemas(
        doc,
        (s) => s.type === 'object' && !s.properties && !s.allOf && !s.oneOf && !s.additionalProperties,
      );

      expect(shapeless).toEqual([]);
    });

    it('AppointmentInspectorDto.profileId é uuid string anulável', () => {
      expect(doc.components.schemas.AppointmentInspectorDto.properties?.profileId).toMatchObject({
        type: 'string',
        format: 'uuid',
        nullable: true,
      });
    });

    it.each([
      ['ErrorResponseDto', 'statusCode'],
      ['PaginatedListingsResponseDto', 'total'],
      ['PaginatedMyListingsResponseDto', 'total'],
      ['PaginatedAppointmentsResponseDto', 'total'],
      ['ListingResponseDto', 'priceCents'],
      ['VehicleResponseDto', 'year'],
      ['InspectorResponseDto', 'basePriceCents'],
      ['InspectorAppointmentResponseDto', 'inspectorPayoutCents'],
      ['CreateListingDto', 'priceCents'],
      ['VehicleDto', 'mileageKm'],
      ['CreateInspectorProfileDto', 'serviceRadiusKm'],
    ])('%s.%s é integer', (schema, field) => {
      expect(doc.components.schemas[schema].properties?.[field]).toMatchObject({ type: 'integer' });
    });

    it.each(['page', 'limit', 'minPriceCents', 'maxPriceCents', 'minYear', 'maxYear'])(
      'o parâmetro %s de GET /listings é integer',
      (name) => {
        const param = op('get', '/listings').parameters?.find((p) => p.name === name);

        expect(param?.schema).toMatchObject({ type: 'integer' });
      },
    );

    it.each([
      ['ListingResponseDto', 'id'],
      ['MyListingResponseDto', 'id'],
      ['InspectorResponseDto', 'id'],
      ['UserResponseDto', 'id'],
    ])('%s.%s é uuid', (schema, field) => {
      expect(doc.components.schemas[schema].properties?.[field]).toMatchObject({
        type: 'string',
        format: 'uuid',
      });
    });

    it('ErrorResponseDto.timestamp é date-time', () => {
      expect(doc.components.schemas.ErrorResponseDto.properties?.timestamp).toMatchObject({
        type: 'string',
        format: 'date-time',
      });
    });
  });

  describe('determinismo (não muda sozinho na virada do ano)', () => {
    it.each([
      ['VehicleDto', 'year'],
      ['VehicleResponseDto', 'year'],
    ])('%s.%s não tem maximum e descreve a regra do ano', (schema, field) => {
      const prop = doc.components.schemas[schema].properties?.[field];

      expect(prop).not.toHaveProperty('maximum');
      expect(prop?.description).toContain('1950 até o ano atual + 1');
    });

    it.each(['minYear', 'maxYear'])(
      'o parâmetro %s de GET /listings não tem maximum e descreve a regra do ano',
      (name) => {
        const param = op('get', '/listings').parameters?.find((p) => p.name === name);

        expect(param?.schema).toMatchObject({ minimum: 1950 });
        expect(param?.schema).not.toHaveProperty('maximum');
        expect(param?.schema.description ?? (param as { description?: string } | undefined)?.description)
          .toContain('1950 até o ano atual + 1');
      },
    );

    it('o documento não contém o ano que vem como maximum', () => {
      const nextYear = new Date().getFullYear() + 1;

      expect(findSchemas(doc, (s) => s.maximum === nextYear)).toEqual([]);
    });
  });
});
