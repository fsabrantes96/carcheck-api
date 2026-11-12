import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AppointmentExpiryCron, APPOINTMENT_EXPIRY_CRON } from '../appointments/appointment-expiry.cron.js';
import { AppointmentExpiryModule } from '../appointments/appointment-expiry.module.js';
import { AppointmentExpiryService } from '../appointments/appointment-expiry.service.js';
import { ClockModule } from '../common/clock/clock.js';
import { validateEnv } from '../config/env.validation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { jobsModuleWhenEnabled } from './jobs.module.js';

/** PrismaService falso e global: o teste não abre conexão com o banco. */
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: { appointment: { updateMany: vi.fn() } } }],
  exports: [PrismaService],
})
class FakePrismaModule {}

/**
 * Monta os módulos como o AppModule: o ConfigModule (com o validateEnv) é
 * importado antes, e a condição do ConditionalModule só é avaliada depois
 * de ele carregar as variáveis.
 */
async function compileWith(jobsEnabled: string | undefined): Promise<TestingModule> {
  vi.stubEnv('PLATFORM_FEE_BPS', '1000');
  vi.stubEnv('JOBS_ENABLED', jobsEnabled);
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnv }),
      ClockModule,
      FakePrismaModule,
      AppointmentExpiryModule,
      jobsModuleWhenEnabled(),
    ],
  }).compile();
}

describe('JobsModule (liga/desliga com JOBS_ENABLED)', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    vi.unstubAllEnvs();
  });

  it('com JOBS_ENABLED=false, a classe do @Cron não existe e o AppointmentExpiryService existe', async () => {
    moduleRef = await compileWith('false');

    expect(() => moduleRef!.get(AppointmentExpiryCron, { strict: false })).toThrow();
    expect(() => moduleRef!.get(SchedulerRegistry, { strict: false })).toThrow();
    expect(moduleRef.get(AppointmentExpiryService, { strict: false })).toBeInstanceOf(AppointmentExpiryService);
  });

  it('com JOBS_ENABLED=true, registra o cron de expiração a cada minuto', async () => {
    moduleRef = await compileWith('true');
    await moduleRef.init();

    const registry = moduleRef.get(SchedulerRegistry, { strict: false });
    expect(moduleRef.get(AppointmentExpiryCron, { strict: false })).toBeInstanceOf(AppointmentExpiryCron);
    expect(registry.doesExist('cron', APPOINTMENT_EXPIRY_CRON)).toBe(true);
    expect(registry.getCronJob(APPOINTMENT_EXPIRY_CRON).cronTime.source).toBe('*/1 * * * *');
  });

  it('com JOBS_ENABLED ausente, o cron é registrado (padrão true)', async () => {
    moduleRef = await compileWith(undefined);

    expect(moduleRef.get(AppointmentExpiryCron, { strict: false })).toBeInstanceOf(AppointmentExpiryCron);
  });
});
