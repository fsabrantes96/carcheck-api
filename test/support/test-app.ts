import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { getStorageToken, ThrottlerStorageService } from '@nestjs/throttler';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp, createHttpAdapter } from '../../src/app.setup.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { assertTestDatabaseUrl } from './test-database.js';

/**
 * Storage do throttler com limites 1000 vezes maiores: os e2e fazem vários
 * logins e cadastros seguidos do mesmo IP e não podem esbarrar no 5/min.
 * O 429 é coberto num teste próprio, com o storage real.
 */
class HighLimitThrottlerStorage extends ThrottlerStorageService {
  override increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ReturnType<ThrottlerStorageService['increment']> {
    return super.increment(
      key,
      ttl,
      limit * 1000,
      blockDuration,
      throttlerName,
    );
  }
}

export interface TestAppOptions {
  /** Usa o throttler com os limites reais da aplicação (só no teste do 429). */
  realThrottler?: boolean;
  /** Sobrescritas extras do módulo (ex.: um PrismaService que falha). */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Cria a app como em produção (mesmo adapter e mesma configureApp do
 * main.ts), sobre o AppModule inteiro e o banco de teste.
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<INestApplication<App>> {
  assertTestDatabaseUrl(process.env.DATABASE_URL);

  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (!options.realThrottler) {
    builder = builder
      .overrideProvider(getStorageToken())
      .useClass(HighLimitThrottlerStorage);
  }
  if (options.configure) builder = options.configure(builder);

  const moduleRef = await builder.compile();
  const app =
    moduleRef.createNestApplication<INestApplication<App>>(createHttpAdapter());
  configureApp(app);
  await app.init();
  return app;
}

/**
 * Fecha a app. As conexões do Prisma com o banco fecham junto, no
 * onApplicationShutdown do PrismaService (test/shutdown.e2e-spec.ts). Um
 * substituto do PrismaService passado em `configure` que não tenha esse hook
 * (ex.: um PrismaClient puro) precisa ser desconectado pelo próprio teste.
 */
export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.close();
}

/** Apaga os dados de todas as tabelas do banco de teste. */
export async function resetDatabase(app: INestApplication): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL);
  await app.get(PrismaService)
    .$executeRaw`TRUNCATE TABLE "Appointment", "VehicleDetails", "Listing", "InspectorProfile", "User" RESTART IDENTITY CASCADE`;
}
