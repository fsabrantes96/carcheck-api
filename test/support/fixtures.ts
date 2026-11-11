import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';

/** Chaves do formato único de erro (sem `errors`). */
export const ERROR_KEYS = [
  'error',
  'message',
  'path',
  'statusCode',
  'timestamp',
].sort();

/** Chaves do formato de erro de validação (com `errors`). */
export const VALIDATION_ERROR_KEYS = [...ERROR_KEYS, 'errors'].sort();

export const DEFAULT_PASSWORD = 'senha12345';

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

/** Cadastra e faz login, devolvendo o id e o token do usuário. */
export async function registerAndLogin(
  app: INestApplication<App>,
  email: string,
  name = 'Usuário de Teste',
): Promise<TestUser> {
  const server = app.getHttpServer();
  const registered = await request(server)
    .post('/auth/register')
    .send({ name, email, password: DEFAULT_PASSWORD })
    .expect(201);
  const login = await request(server)
    .post('/auth/login')
    .send({ email, password: DEFAULT_PASSWORD })
    .expect(200);
  return {
    id: (registered.body as { id: string }).id,
    email,
    token: (login.body as { accessToken: string }).accessToken,
  };
}

export const inspectorProfilePayload = {
  bio: 'Mecânico há 15 anos, especialista em câmbio automático.',
  specialties: ['ENGINE', 'TRANSMISSION'],
  city: 'Barretos',
  state: 'SP',
  serviceRadiusKm: 30,
  basePriceCents: 15000,
};

export function listingPayload(
  overrides: {
    title?: string;
    priceCents?: number;
    city?: string;
    state?: string;
    brand?: string;
    year?: number;
  } = {},
) {
  return {
    title: overrides.title ?? 'Gol 1.0 2018 completo',
    description: 'Único dono, revisões em dia, pneus novos.',
    priceCents: overrides.priceCents ?? 4_500_000,
    city: overrides.city ?? 'Boituva',
    state: overrides.state ?? 'SP',
    vehicle: {
      brand: overrides.brand ?? 'Volkswagen',
      model: 'Gol',
      year: overrides.year ?? 2018,
      mileageKm: 68_000,
      fuel: 'FLEX',
      transmission: 'MANUAL',
    },
  };
}
