import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import {
  AppointmentActor,
  AppointmentStatus,
  FuelType,
  ListingStatus,
  Role,
  Specialty,
  Transmission,
} from '../src/generated/prisma/client.js';
import { appointmentResponseSchema } from '../src/appointments/dto/appointment-response.dto.js';
import { closeTestApp, createTestApp } from './support/test-app.js';

type Schema = Record<string, unknown> & {
  properties?: Record<string, Schema>;
  items?: Schema;
};
type Param = { name: string; in: string; schema: Schema };
type Response = { description: string; content?: Record<string, { schema: Schema }> };
type Operation = {
  operationId?: string;
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

/** Cada `enum` do documento com o caminho até ele (ex.: components/schemas/X/properties/y). */
function enumLocations(node: unknown, path: string[] = [], found: { path: string[]; values: unknown[] }[] = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => enumLocations(item, [...path, String(i)], found));
  } else if (node && typeof node === 'object') {
    const values = (node as Schema).enum;
    if (Array.isArray(values)) found.push({ path: [...path, 'enum'], values });
    for (const [key, value] of Object.entries(node)) enumLocations(value, [...path, key], found);
  }
  return found;
}

/**
 * Enum inline permitido: só a propriedade discriminadora de uma variante de
 * oneOf (ex.: myRole), com um único valor, que é a chave do mapping que
 * aponta para aquela variante. O OpenAPI 3.0 não tem const; trocar pelo enum
 * nomeado faria os geradores perderem o estreitamento por variante.
 */
function isDiscriminatorLiteral(doc: Doc, path: string[], values: unknown[]): boolean {
  const [c, s, schemaName, p, property, ...rest] = path;
  if (c !== 'components' || s !== 'schemas' || p !== 'properties' || rest.length > 0) return false;
  if (values.length !== 1) return false;
  const ref = `#/components/schemas/${schemaName}`;
  const discriminators = findSchemas(doc, (n) => Boolean(n.discriminator)).map(
    (n) => n.discriminator as { propertyName: string; mapping: Record<string, string> },
  );
  return discriminators.some(
    (d) => d.propertyName === property && d.mapping[values[0] as string] === ref,
  );
}

/** Tabela aprovada de operationIds: [método, caminho, operationId]. Rota nova entra aqui. */
const OPERATION_IDS: [string, string, string][] = [
  ['post', '/auth/register', 'registerUser'],
  ['post', '/auth/login', 'login'],
  ['get', '/auth/me', 'getCurrentUser'],
  ['get', '/inspectors', 'listInspectors'],
  ['post', '/inspectors/me', 'createMyInspectorProfile'],
  ['get', '/inspectors/me', 'getMyInspectorProfile'],
  ['patch', '/inspectors/me', 'updateMyInspectorProfile'],
  ['get', '/listings', 'listListings'],
  ['post', '/listings', 'createListing'],
  ['get', '/listings/mine', 'listMyListings'],
  ['get', '/listings/{id}', 'getListing'],
  ['patch', '/listings/{id}', 'updateListing'],
  ['delete', '/listings/{id}', 'archiveListing'],
  ['post', '/listings/{id}/pause', 'pauseListing'],
  ['post', '/listings/{id}/activate', 'activateListing'],
  ['post', '/listings/{id}/mark-sold', 'markListingSold'],
  ['post', '/appointments', 'createAppointment'],
  ['get', '/appointments', 'listAppointments'],
  ['get', '/appointments/{id}', 'getAppointment'],
  ['post', '/appointments/{id}/accept', 'acceptAppointment'],
  ['post', '/appointments/{id}/decline', 'declineAppointment'],
  ['post', '/appointments/{id}/confirm', 'confirmAppointment'],
  ['post', '/appointments/{id}/cancel', 'cancelAppointment'],
];

const NAMED_ENUMS: Record<string, string[]> = {
  ErrorCode: [],
  BrazilianState: [],
  AppointmentStatus: Object.values(AppointmentStatus),
  AppointmentActor: Object.values(AppointmentActor),
  AppointmentAction: ['ACCEPT', 'DECLINE', 'CONFIRM', 'CANCEL'],
  AppointmentParticipant: ['BUYER', 'SELLER', 'INSPECTOR'],
  Specialty: Object.values(Specialty),
  FuelType: Object.values(FuelType),
  Transmission: Object.values(Transmission),
  ListingStatus: Object.values(ListingStatus),
  Role: Object.values(Role),
};

const enumRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/**
 * Propriedade (não array) que aponta para um enum nomeado: o @nestjs/swagger
 * sempre põe o $ref num allOf de um item (equivalente ao $ref direto).
 */
const enumProperty = (name: string) => ({ allOf: [enumRef(name)] });

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

  describe('code do erro', () => {
    it('o ErrorResponseDto tem code obrigatório, referenciando o enum nomeado ErrorCode', () => {
      const error = doc.components.schemas.ErrorResponseDto;

      // Com description/example ao lado, o @nestjs/swagger põe o $ref num allOf.
      expect(error.properties?.code?.allOf).toEqual([
        { $ref: '#/components/schemas/ErrorCode' },
      ]);
      expect(error.required).toContain('code');
    });

    it('o ErrorCode é um enum de strings em SCREAMING_SNAKE_CASE', () => {
      const errorCode = doc.components.schemas.ErrorCode;

      expect(errorCode.type).toBe('string');
      expect(Array.isArray(errorCode.enum)).toBe(true);
      for (const value of errorCode.enum as string[]) {
        expect(value).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
      }
      expect(errorCode.enum).toEqual(
        expect.arrayContaining(['VALIDATION_FAILED', 'ROUTE_NOT_FOUND', 'INTERNAL_ERROR']),
      );
    });

    it('o ErrorCode avisa que a lista pode crescer', () => {
      expect(doc.components.schemas.ErrorCode.description).toContain(
        'A lista pode crescer; trate code desconhecido pelo status HTTP.',
      );
    });

    it.each(['USER_NOT_FOUND', 'METHOD_NOT_ALLOWED'])('o ErrorCode não tem %s (removido antes do front)', (code) => {
      expect(doc.components.schemas.ErrorCode.enum).not.toContain(code);
    });
  });

  describe('operationId', () => {
    // Convenção: <verbo><Recurso> em camelCase, explícito em @ApiOperationId.
    // Sem ele, a operationIdFactory de buildOpenApiDocument devolve o
    // sentinela MISSING_OPERATION_ID_<Controller>_<método>.
    it('toda operação tem operationId explícito em camelCase (sem o sentinela nem o padrão Controller_método)', () => {
      for (const [name, operation] of operations(doc)) {
        expect({ name, operationId: operation.operationId }).toEqual({
          name,
          operationId: expect.stringMatching(/^[a-z][a-zA-Z0-9]*$/),
        });
      }
    });

    it('nenhum operationId se repete', () => {
      const ids = operations(doc).map(([, operation]) => operation.operationId);

      expect(new Set(ids).size).toBe(ids.length);
    });

    it.each(OPERATION_IDS)('%s %s tem operationId %s', (method, path, operationId) => {
      expect(op(method, path).operationId).toBe(operationId);
    });

    it('a tabela OPERATION_IDS cobre exatamente as operações do documento', () => {
      const documented = operations(doc).map(([name]) => name).sort();
      const table = OPERATION_IDS.map(([method, path]) => `${method.toUpperCase()} ${path}`).sort();

      expect(documented).toEqual(table);
    });
  });

  describe('enums nomeados', () => {
    it('nenhum enum sai inline: todo enum é um schema de components.schemas (exceto o literal do discriminador)', () => {
      const inline = enumLocations(doc)
        .filter(({ path }) => !(path.length === 4 && path[0] === 'components' && path[1] === 'schemas' && path[3] === 'enum'))
        .filter(({ path, values }) => !isDiscriminatorLiteral(doc, path.slice(0, -1), values))
        .map(({ path }) => path.join('/'));

      expect(inline).toEqual([]);
    });

    it('a isenção vale só para o myRole das três variantes de agendamento, cada uma com o próprio valor', () => {
      const exempt = enumLocations(doc)
        .filter(({ path, values }) => isDiscriminatorLiteral(doc, path.slice(0, -1), values))
        .map(({ path, values }) => [path.join('/'), values]);

      expect(exempt).toEqual([
        ['components/schemas/BuyerAppointmentResponseDto/properties/myRole/enum', ['BUYER']],
        ['components/schemas/SellerAppointmentResponseDto/properties/myRole/enum', ['SELLER']],
        ['components/schemas/InspectorAppointmentResponseDto/properties/myRole/enum', ['INSPECTOR']],
      ]);
    });

    it.each([
      ['o valor de outra variante', 'myRole', ['SELLER']],
      ['uma propriedade que não é a discriminadora', 'status', ['BUYER']],
      ['um enum com mais de um valor', 'myRole', ['BUYER', 'SELLER']],
    ])('a isenção não vale para %s', (_case, property, values) => {
      const path = ['components', 'schemas', 'BuyerAppointmentResponseDto', 'properties', property as string];

      expect(isDiscriminatorLiteral(doc, path, values as string[])).toBe(false);
    });

    it.each(Object.keys(NAMED_ENUMS))('o enum nomeado %s existe como schema string e é referenciado', (name) => {
      const schema = doc.components.schemas[name];

      expect(schema).toMatchObject({ type: 'string' });
      if (NAMED_ENUMS[name].length > 0) expect(schema.enum).toEqual(NAMED_ENUMS[name]);
      expect(findSchemas(doc, (s) => s.$ref === enumRef(name).$ref).length).toBeGreaterThan(0);
    });

    it('todo schema de enum em components é referenciado em algum lugar (sem enum órfão)', () => {
      const enumSchemas = Object.entries(doc.components.schemas)
        .filter(([, schema]) => Array.isArray(schema.enum))
        .map(([name]) => name);

      expect(enumSchemas.sort()).toEqual(Object.keys(NAMED_ENUMS).sort());
    });

    it.each([
      ['status', 'AppointmentStatus'],
      ['as', 'AppointmentParticipant'],
    ])('o parâmetro %s de GET /appointments referencia %s', (name, enumName) => {
      const param = op('get', '/appointments').parameters?.find((p) => p.name === name);

      expect(param?.schema).toEqual(enumRef(enumName));
    });

    it.each(['BuyerAppointmentResponseDto', 'SellerAppointmentResponseDto', 'InspectorAppointmentResponseDto'])(
      '%s referencia AppointmentStatus, AppointmentAction e, anulável, AppointmentActor',
      (name) => {
        const props = doc.components.schemas[name].properties ?? {};

        expect(props.status).toEqual(enumProperty('AppointmentStatus'));
        expect(props.availableActions).toMatchObject({ type: 'array', items: enumRef('AppointmentAction') });
        // No 3.0, irmãos de $ref são ignorados: o nullable precisa do allOf.
        expect(props.endedBy).toMatchObject({ allOf: [enumRef('AppointmentActor')], nullable: true });
        expect(props.endedBy).not.toHaveProperty('$ref');
      },
    );

    it.each(['InspectorResponseDto', 'MyInspectorProfileResponseDto', 'CreateInspectorProfileDto', 'UpdateInspectorProfileDto'])(
      '%s.specialties é array de Specialty',
      (name) => {
        expect(doc.components.schemas[name].properties?.specialties).toMatchObject({
          type: 'array',
          items: enumRef('Specialty'),
        });
      },
    );

    it.each(['VehicleDto', 'VehicleResponseDto'])('%s referencia FuelType e Transmission', (name) => {
      const props = doc.components.schemas[name].properties ?? {};

      expect(props.fuel).toEqual(enumProperty('FuelType'));
      expect(props.transmission).toEqual(enumProperty('Transmission'));
    });

    it('MyListingResponseDto.status referencia ListingStatus', () => {
      expect(doc.components.schemas.MyListingResponseDto.properties?.status).toEqual(enumProperty('ListingStatus'));
    });
  });

  describe('união de agendamento (AppointmentResponseDto)', () => {
    const UNION_REF = { $ref: '#/components/schemas/AppointmentResponseDto' };
    const okSchema = (method: string, path: string) =>
      op(method, path).responses['200'].content?.['application/json']?.schema;

    it('é um schema nomeado: oneOf das três variantes com discriminator em myRole', () => {
      expect(doc.components.schemas.AppointmentResponseDto).toEqual({
        oneOf: [
          { $ref: '#/components/schemas/BuyerAppointmentResponseDto' },
          { $ref: '#/components/schemas/SellerAppointmentResponseDto' },
          { $ref: '#/components/schemas/InspectorAppointmentResponseDto' },
        ],
        discriminator: {
          propertyName: 'myRole',
          mapping: {
            BUYER: '#/components/schemas/BuyerAppointmentResponseDto',
            SELLER: '#/components/schemas/SellerAppointmentResponseDto',
            INSPECTOR: '#/components/schemas/InspectorAppointmentResponseDto',
          },
        },
      });
    });

    it('o schema registrado em buildOpenApiDocument é idêntico no /docs-json e no openapi.json', () => {
      const versioned = JSON.parse(
        readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
      ) as Doc;

      expect(doc.components.schemas.AppointmentResponseDto).toEqual(appointmentResponseSchema());
      expect(versioned.components.schemas.AppointmentResponseDto).toEqual(appointmentResponseSchema());
    });

    it.each([
      ['get', '/appointments/{id}'],
      ['post', '/appointments/{id}/cancel'],
    ])('o 200 de %s %s referencia AppointmentResponseDto', (method, path) => {
      expect(okSchema(method, path)).toEqual(UNION_REF);
    });

    it('os itens de PaginatedAppointmentsResponseDto referenciam AppointmentResponseDto', () => {
      expect(doc.components.schemas.PaginatedAppointmentsResponseDto.properties?.items).toMatchObject({
        type: 'array',
        items: UNION_REF,
      });
    });

    it('nenhum oneOf fica inline: o único é o do schema nomeado', () => {
      expect(findSchemas(doc, (s) => Array.isArray(s.oneOf))).toEqual([
        doc.components.schemas.AppointmentResponseDto,
      ]);
    });
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
      ['get', '/inspectors'],
    ])('%s %s documenta o 400 de validação', (method, path) => {
      expect(errorSchema(op(method, path), '400')).toEqual(ERROR_REF);
    });

    it('GET /inspectors responde PaginatedInspectorsResponseDto com itens InspectorResponseDto', () => {
      expect(op('get', '/inspectors').responses['200'].content?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/PaginatedInspectorsResponseDto',
      });
      const props = doc.components.schemas.PaginatedInspectorsResponseDto.properties ?? {};
      expect(Object.keys(props).sort()).toEqual(['items', 'limit', 'page', 'total']);
      expect(props.items).toEqual({
        type: 'array',
        items: { $ref: '#/components/schemas/InspectorResponseDto' },
      });
    });

    it('GET /inspectors documenta page (1 a 200) e limit (1 a 50) inteiros e cita os limites no 400', () => {
      const param = (name: string) =>
        op('get', '/inspectors').parameters?.find((p) => p.name === name && p.in === 'query')?.schema;

      expect(param('page')).toMatchObject({ type: 'integer', minimum: 1, maximum: 200, default: 1 });
      expect(param('limit')).toMatchObject({ type: 'integer', minimum: 1, maximum: 50, default: 20 });
      expect(op('get', '/inspectors').responses['400'].description).toContain('page de 1 a 200, limit de 1 a 50');
    });

    it('GET /auth/me responde CurrentUserResponseDto, com roles obrigatório como array de Role', () => {
      expect(op('get', '/auth/me').responses['200'].content?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/CurrentUserResponseDto',
      });
      const schema = doc.components.schemas.CurrentUserResponseDto;
      expect(schema.properties?.roles).toMatchObject({ type: 'array', items: enumRef('Role') });
      expect(schema.required).toContain('roles');
    });

    it('POST /auth/register continua respondendo UserResponseDto, que não tem roles', () => {
      expect(op('post', '/auth/register').responses['201'].content?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/UserResponseDto',
      });
      expect(doc.components.schemas.UserResponseDto.properties).not.toHaveProperty('roles');
    });

    it('POST /auth/login continua com user do tipo UserResponseDto', () => {
      expect(doc.components.schemas.LoginResponseDto.properties?.user).toEqual({
        $ref: '#/components/schemas/UserResponseDto',
      });
    });

    it('GET /auth/me documenta no 401 a conta que não existe mais, sem 404', () => {
      expect(errorSchema(op('get', '/auth/me'), '401')).toEqual(ERROR_REF);
      expect(op('get', '/auth/me').responses['401'].description).toContain('conta que não existe mais');
      expect(op('get', '/auth/me').responses).not.toHaveProperty('404');
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
    it('toda $ref do documento aponta para um schema existente em components.schemas', () => {
      const dangling = findSchemas(doc, (s) => typeof s.$ref === 'string')
        .map((s) => s.$ref as string)
        .filter((ref) => !(ref.replace('#/components/schemas/', '') in doc.components.schemas));

      expect(dangling).toEqual([]);
    });

    it('a mapping do discriminador também aponta para schemas existentes', () => {
      const targets = findSchemas(doc, (s) => Boolean(s.discriminator)).flatMap((s) =>
        Object.values((s.discriminator as { mapping: Record<string, string> }).mapping),
      );

      expect(targets.length).toBeGreaterThan(0);
      for (const ref of targets) {
        expect(doc.components.schemas).toHaveProperty([ref.replace('#/components/schemas/', '')]);
      }
    });

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
      ['PaginatedInspectorsResponseDto', 'total'],
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
