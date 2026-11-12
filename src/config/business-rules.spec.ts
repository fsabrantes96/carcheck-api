import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BUSINESS_RULES, BusinessRulesModule } from './business-rules.js';
import type { BusinessRules } from './business-rules.js';
import { validateEnv } from './env.validation.js';

const NAMES = [
  'PLATFORM_FEE_BPS',
  'MIN_INSPECTION_PRICE_CENTS',
  'APPOINTMENT_DURATION_MINUTES',
  'APPOINTMENT_MIN_NOTICE_HOURS',
] as const;

describe('BusinessRulesModule', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of NAMES) saved[name] = process.env[name];
  });

  afterEach(() => {
    for (const name of NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  async function rulesFor(env: Partial<Record<(typeof NAMES)[number], string>>) {
    for (const name of NAMES) delete process.env[name];
    Object.assign(process.env, env);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: validateEnv }),
        BusinessRulesModule,
      ],
    }).compile();
    return moduleRef.get<BusinessRules>(BUSINESS_RULES);
  }

  it('entrega as regras validadas como números, com os padrões aplicados', async () => {
    const rules = await rulesFor({ PLATFORM_FEE_BPS: '750' });

    expect(rules).toEqual({
      platformFeeBps: 750,
      minInspectionPriceCents: 5000,
      appointmentDurationMinutes: 60,
      appointmentMinNoticeHours: 24,
    });
  });

  it('não sobe quando PLATFORM_FEE_BPS está ausente', async () => {
    await expect(rulesFor({})).rejects.toThrow('PLATFORM_FEE_BPS é obrigatória');
  });
});
