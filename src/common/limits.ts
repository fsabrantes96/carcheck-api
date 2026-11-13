/**
 * Limites de entrada da API. Fazem parte do contrato: cada constante é usada
 * ao mesmo tempo pelo class-validator (`@MaxLength`, `@Max`...) e pelo
 * Swagger (`@ApiProperty({ maxLength, maximum })`), de onde o front gera os
 * tipos. Mude o valor aqui, nunca no DTO.
 *
 * Todos os números ficam abaixo de 2.147.483.647, o teto das colunas `Int`
 * (32 bits) do Postgres: acima disso o banco rejeita e a API respondia 500.
 */

import { Specialty } from '../generated/prisma/client.js';

// Usuário
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 100;
/** Teto de endereço de e-mail do RFC 5321. */
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
/** O bcrypt só considera os primeiros 72 bytes (UTF-8) da senha. */
export const PASSWORD_MAX_BYTES = 72;

// Localização (anúncio, perfil do avaliador e filtros)
export const CITY_MIN_LENGTH = 2;
export const CITY_MAX_LENGTH = 100;
/** Sigla do estado. */
export const STATE_LENGTH = 2;

// Anúncio
export const LISTING_TITLE_MIN_LENGTH = 5;
export const LISTING_TITLE_MAX_LENGTH = 120;
export const LISTING_DESCRIPTION_MIN_LENGTH = 20;
export const LISTING_DESCRIPTION_MAX_LENGTH = 2000;
export const LISTING_PRICE_MIN_CENTS = 1;
/** R$ 10.000.000,00. */
export const LISTING_PRICE_MAX_CENTS = 1_000_000_000;
/** Os filtros de preço de GET /listings aceitam 0 (sem piso). */
export const PRICE_FILTER_MIN_CENTS = 0;

// Veículo (e filtros de GET /listings)
export const VEHICLE_BRAND_MIN_LENGTH = 2;
export const VEHICLE_BRAND_MAX_LENGTH = 100;
export const VEHICLE_MODEL_MIN_LENGTH = 1;
export const VEHICLE_MODEL_MAX_LENGTH = 100;
export const VEHICLE_YEAR_MIN = 1950;
/**
 * Ano que vem. Calculado quando o módulo carrega: um processo que atravessa
 * o Ano-Novo continua com o teto antigo até reiniciar (ver docs/audit.md).
 */
export const VEHICLE_YEAR_MAX = new Date().getFullYear() + 1;
export const VEHICLE_MILEAGE_MIN_KM = 0;
export const VEHICLE_MILEAGE_MAX_KM = 2_000_000;

// Perfil do avaliador
export const INSPECTOR_BIO_MIN_LENGTH = 20;
export const INSPECTOR_BIO_MAX_LENGTH = 2000;
/** Especialidades: pelo menos uma e no máximo todas as do enum, sem repetir. */
export const SPECIALTIES_MIN_ITEMS = 1;
export const SPECIALTIES_MAX_ITEMS = Object.values(Specialty).length;
export const SERVICE_RADIUS_MIN_KM = 1;
export const SERVICE_RADIUS_MAX_KM = 200;
/**
 * Piso do DTO. O mínimo de negócio (MIN_INSPECTION_PRICE_CENTS, configurável)
 * é aplicado pelo InspectorsService no cadastro e na edição do perfil (400) e
 * de novo ao criar o agendamento; por ser configurável, não fica no DTO.
 */
export const INSPECTION_PRICE_MIN_CENTS = 0;
/** R$ 5.000,00. Também é o teto de MIN_INSPECTION_PRICE_CENTS no validateEnv. */
export const INSPECTION_PRICE_MAX_CENTS = 500_000;

// Agendamento
export const MEETING_ADDRESS_MIN_LENGTH = 5;
export const MEETING_ADDRESS_MAX_LENGTH = 300;

// Paginação
export const PAGE_MIN = 1;
export const PAGE_LIMIT_MIN = 1;
export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 50;
/** No máximo 10.000 registros pulados (`skip`) numa listagem pública. */
export const MAX_SKIPPED_ROWS = 10_000;
/** 10.000 ÷ 50 = 200: com qualquer `limit`, `skip` não passa de 10.000. */
export const LISTINGS_PAGE_MAX = Math.floor(MAX_SKIPPED_ROWS / PAGE_LIMIT_MAX);
/** Teto de GET /appointments (lista do próprio usuário), mantido desde o risco 49. */
export const APPOINTMENTS_PAGE_MAX = 10_000;

// Corpo da requisição
/** Padrão do body-parser do Express, configurado de forma explícita. */
export const BODY_SIZE_LIMIT = '100kb';
