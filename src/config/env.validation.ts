/**
 * Validação das variáveis de ambiente das regras de negócio e dos jobs, feita no boot
 * pelo ConfigModule (opção `validate`). Se algo estiver errado, a aplicação
 * não sobe e a mensagem diz exatamente o que configurar.
 */

/** Variáveis de regra de negócio já convertidas para número. */
export interface BusinessEnv {
  /** Comissão da plataforma em pontos-base (1000 = 10%). Obrigatória. */
  PLATFORM_FEE_BPS: number;
  /** Preço mínimo da avaliação, em centavos. */
  MIN_INSPECTION_PRICE_CENTS: number;
  /** Duração fixa de uma avaliação, em minutos. */
  APPOINTMENT_DURATION_MINUTES: number;
  /** Antecedência mínima para agendar, em horas. */
  APPOINTMENT_MIN_NOTICE_HOURS: number;
}

interface IntRule {
  min: number;
  max: number;
  /** Ausente = obrigatória. */
  default?: number;
  /** Descrição usada na mensagem de erro. */
  hint: string;
}

/** Horizonte máximo de agendamento (60 dias), em horas. */
const MAX_ADVANCE_HOURS = 60 * 24;

const RULES: Record<keyof BusinessEnv, IntRule> = {
  PLATFORM_FEE_BPS: {
    min: 0,
    max: 10_000,
    hint: 'comissão da plataforma em pontos-base, inteiro entre 0 e 10000 (1000 = 10%)',
  },
  MIN_INSPECTION_PRICE_CENTS: {
    min: 1,
    max: 100_000_000,
    default: 5000,
    hint: 'preço mínimo da avaliação em centavos, inteiro a partir de 1 (5000 = R$ 50,00)',
  },
  APPOINTMENT_DURATION_MINUTES: {
    min: 1,
    max: 24 * 60,
    default: 60,
    hint: 'duração da avaliação em minutos, inteiro entre 1 e 1440',
  },
  APPOINTMENT_MIN_NOTICE_HOURS: {
    min: 0,
    max: MAX_ADVANCE_HOURS - 1,
    default: 24,
    hint: `antecedência mínima em horas, inteiro entre 0 e ${MAX_ADVANCE_HOURS - 1} (menor que o horizonte de 60 dias)`,
  },
};

/** Variáveis dos jobs agendados, já convertidas. */
export interface JobsEnv {
  /** Liga os jobs agendados (cron). Padrão true; os e2e usam false. */
  JOBS_ENABLED: boolean;
}

const JOBS_ENABLED_DEFAULT = true;
const JOBS_ENABLED_HINT = 'liga os jobs agendados, true ou false (padrão true)';

/**
 * Lê um boolean do ambiente: ausente ou vazio → `fallback`; "true"/"false"
 * sem diferenciar maiúsculas e com espaços em volta; boolean já convertido
 * passa direto. Qualquer outro valor → undefined (inválido).
 */
function parseBoolean(raw: unknown, fallback: boolean): boolean | undefined {
  if (typeof raw === 'boolean') return raw;
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().toLowerCase();
  if (text === '') return fallback;
  if (text === 'true') return true;
  if (text === 'false') return false;
  return undefined;
}

/**
 * Os jobs agendados estão ligados? Mesma leitura do validateEnv; é a condição
 * do ConditionalModule (lida do process.env). Valor inválido não liga nada,
 * mas nem chega aqui: o validateEnv já derrubou o boot.
 */
export function isJobsEnabled(env: Record<string, unknown>): boolean {
  return parseBoolean(env.JOBS_ENABLED, JOBS_ENABLED_DEFAULT) === true;
}

function parseInteger(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * Confere e converte as variáveis de regra de negócio. Devolve a configuração
 * recebida com esses valores já como número; lança um Error listando todos os
 * problemas encontrados.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> & BusinessEnv & JobsEnv {
  const problems: string[] = [];
  const parsed = {} as BusinessEnv & JobsEnv;

  for (const [name, rule] of Object.entries(RULES) as [keyof BusinessEnv, IntRule][]) {
    const raw = config[name];
    const missing = raw === undefined || (typeof raw === 'string' && raw.trim() === '');

    if (missing) {
      if (rule.default === undefined) {
        problems.push(`${name} é obrigatória: ${rule.hint}.`);
      } else {
        parsed[name] = rule.default;
      }
      continue;
    }

    const value = parseInteger(raw);
    if (value === undefined || value < rule.min || value > rule.max) {
      problems.push(`${name} inválida (recebido: ${JSON.stringify(raw)}): ${rule.hint}.`);
      continue;
    }
    parsed[name] = value;
  }

  const jobsEnabled = parseBoolean(config.JOBS_ENABLED, JOBS_ENABLED_DEFAULT);
  if (jobsEnabled === undefined) {
    problems.push(`JOBS_ENABLED inválida (recebido: ${JSON.stringify(config.JOBS_ENABLED)}): ${JOBS_ENABLED_HINT}.`);
  } else {
    parsed.JOBS_ENABLED = jobsEnabled;
  }

  if (problems.length > 0) {
    throw new Error(
      `Configuração inválida. Corrija as variáveis de ambiente (veja o .env.example):\n- ${problems.join('\n- ')}`,
    );
  }

  return { ...config, ...parsed };
}
