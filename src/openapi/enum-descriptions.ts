import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Aviso dos enums de resposta abertos: valores só são acrescentados, nunca
 * removidos nem renomeados, e o cliente precisa aceitar um valor que ainda
 * não conhece (mesma regra do ErrorCode).
 */
export const OPEN_ENUM_NOTE =
  'A lista pode crescer; trate valor desconhecido sem quebrar.';

/**
 * Descrição própria de cada enum nomeado. O @nestjs/swagger copia para o
 * schema do enum a descrição do primeiro campo que o registra (ex.: "Quem
 * encerrou..." do endedBy virava a descrição de AppointmentActor), e a ordem
 * de registro decide qual vence. Aqui a descrição é neutra e fixa; a de cada
 * campo continua no campo. ErrorCode e BrazilianState já têm descrição
 * própria na origem e ficam fora.
 */
export const NAMED_ENUM_DESCRIPTIONS: Record<string, string> = {
  AppointmentStatus: `Estado do agendamento. ${OPEN_ENUM_NOTE}`,
  AppointmentActor: `Quem executou uma ação no agendamento: comprador, vendedor, avaliador ou o sistema (expiração). ${OPEN_ENUM_NOTE}`,
  AppointmentAction: `Ação sobre o agendamento, uma por rota de intenção. ${OPEN_ENUM_NOTE}`,
  Role: `Papel global do usuário na plataforma. ${OPEN_ENUM_NOTE}`,
  AppointmentParticipant: 'Papel de um usuário num agendamento.',
  Specialty: 'Especialidade do avaliador.',
  FuelType: 'Tipo de combustível do veículo.',
  Transmission: 'Tipo de câmbio do veículo.',
  ListingStatus: 'Status do anúncio.',
};

/**
 * Aplica NAMED_ENUM_DESCRIPTIONS ao documento. Falha se um nome do mapa não
 * for um enum do documento, para o mapa não ficar desatualizado em silêncio.
 */
export function applyEnumDescriptions(document: OpenAPIObject): void {
  const schemas = document.components?.schemas ?? {};
  for (const [name, description] of Object.entries(NAMED_ENUM_DESCRIPTIONS)) {
    const schema = schemas[name];
    if (!schema || !('enum' in schema)) {
      throw new Error(
        `NAMED_ENUM_DESCRIPTIONS cita ${name}, que não é um enum do documento OpenAPI`,
      );
    }
    schema.description = description;
  }
}
