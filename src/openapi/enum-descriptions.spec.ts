import type { OpenAPIObject } from '@nestjs/swagger';
import { applyEnumDescriptions, NAMED_ENUM_DESCRIPTIONS } from './enum-descriptions.js';

function documentWith(schemas: Record<string, object>): OpenAPIObject {
  return { openapi: '3.0.0', info: { title: 't', version: '0' }, paths: {}, components: { schemas } };
}

function allEnums(extra: Record<string, object> = {}): Record<string, object> {
  const schemas: Record<string, object> = {};
  for (const name of Object.keys(NAMED_ENUM_DESCRIPTIONS)) {
    schemas[name] = { type: 'string', enum: ['A'], description: 'descrição do campo que registrou' };
  }
  return { ...schemas, ...extra };
}

describe('applyEnumDescriptions', () => {
  it('troca a descrição herdada do campo pela descrição própria do enum', () => {
    const document = documentWith(allEnums());

    applyEnumDescriptions(document);

    expect(document.components?.schemas?.AppointmentActor).toMatchObject({
      description: NAMED_ENUM_DESCRIPTIONS.AppointmentActor,
    });
  });

  it('não mexe em enum fora do mapa (ex.: ErrorCode)', () => {
    const document = documentWith(allEnums({ ErrorCode: { type: 'string', enum: ['X'], description: 'própria' } }));

    applyEnumDescriptions(document);

    expect(document.components?.schemas?.ErrorCode).toMatchObject({ description: 'própria' });
  });

  it('falha quando o mapa cita um enum que não existe no documento', () => {
    const schemas = allEnums();
    delete schemas.Specialty;

    expect(() => applyEnumDescriptions(documentWith(schemas))).toThrow(
      'NAMED_ENUM_DESCRIPTIONS cita Specialty, que não é um enum do documento OpenAPI',
    );
  });
});
