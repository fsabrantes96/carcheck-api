import { Global, Module } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BusinessEnv } from './env.validation.js';

/** Regras de negócio vindas do ambiente, já validadas no boot. */
export interface BusinessRules {
  /** Comissão da plataforma em pontos-base (1000 = 10%). */
  platformFeeBps: number;
  /** Preço mínimo da avaliação, em centavos. */
  minInspectionPriceCents: number;
  /** Duração fixa de uma avaliação, em minutos. */
  appointmentDurationMinutes: number;
  /** Antecedência mínima para agendar, em horas. */
  appointmentMinNoticeHours: number;
}

/** Token de injeção: `@Inject(BUSINESS_RULES) rules: BusinessRules`. */
export const BUSINESS_RULES = Symbol('BUSINESS_RULES');

const businessRulesProvider: Provider = {
  provide: BUSINESS_RULES,
  inject: [ConfigService],
  useFactory: (config: ConfigService<BusinessEnv, true>): BusinessRules => ({
    platformFeeBps: config.get('PLATFORM_FEE_BPS', { infer: true }),
    minInspectionPriceCents: config.get('MIN_INSPECTION_PRICE_CENTS', { infer: true }),
    appointmentDurationMinutes: config.get('APPOINTMENT_DURATION_MINUTES', { infer: true }),
    appointmentMinNoticeHours: config.get('APPOINTMENT_MIN_NOTICE_HOURS', { infer: true }),
  }),
};

@Global()
@Module({
  providers: [businessRulesProvider],
  exports: [BUSINESS_RULES],
})
export class BusinessRulesModule {}
