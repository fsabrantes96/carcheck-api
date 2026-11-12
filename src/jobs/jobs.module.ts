import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppointmentExpiryCron } from '../appointments/appointment-expiry.cron.js';
import { AppointmentExpiryModule } from '../appointments/appointment-expiry.module.js';
import { isJobsEnabled } from '../config/env.validation.js';

/** Agendador (ScheduleModule) e as classes com @Cron. */
@Module({
  imports: [ScheduleModule.forRoot(), AppointmentExpiryModule],
  providers: [AppointmentExpiryCron],
})
export class JobsModule {}

/**
 * Importa o JobsModule só com JOBS_ENABLED=true (padrão). O ConditionalModule
 * espera o ConfigModule carregar e validar o .env antes de avaliar a
 * condição; com false, nem o agendador nem os crons entram na aplicação.
 * Importe depois do ConfigModule.forRoot.
 */
export function jobsModuleWhenEnabled() {
  return ConditionalModule.registerWhen(JobsModule, (env) => isJobsEnabled(env));
}
