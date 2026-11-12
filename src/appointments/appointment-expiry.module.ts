import { Module } from '@nestjs/common';
import { AppointmentExpiryService } from './appointment-expiry.service.js';

/**
 * Serviço de expiração, sempre carregado (os testes o chamam direto). O cron
 * que o executa fica no JobsModule, que só entra com JOBS_ENABLED=true.
 */
@Module({
  providers: [AppointmentExpiryService],
  exports: [AppointmentExpiryService],
})
export class AppointmentExpiryModule {}
