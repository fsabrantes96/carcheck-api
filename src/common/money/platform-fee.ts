/** Divisão de um preço entre a comissão da plataforma e o repasse do avaliador. */
export interface PlatformFeeSplit {
  platformFeeCents: number;
  inspectorPayoutCents: number;
}

const BPS_DENOMINATOR = 10_000;

/**
 * Divide `priceCents` entre a comissão da plataforma e o repasse do avaliador.
 *
 * - Comissão arredondada meio para cima, só com inteiros (sem float):
 *   `fee = floor((price * bps + 5000) / 10000)`.
 * - `payout = price - fee`, então `fee + payout === price` sempre vale.
 *
 * Lança RangeError se `priceCents` não for inteiro seguro >= 0, se `feeBps`
 * não for inteiro entre 0 e 10000, ou se `price * bps` sair da faixa segura.
 */
export function splitPlatformFee(priceCents: number, feeBps: number): PlatformFeeSplit {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    throw new RangeError(`priceCents deve ser um inteiro >= 0 (recebido: ${priceCents})`);
  }
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > BPS_DENOMINATOR) {
    throw new RangeError(`feeBps deve ser um inteiro entre 0 e 10000 (recebido: ${feeBps})`);
  }
  const scaled = priceCents * feeBps + BPS_DENOMINATOR / 2;
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError(`priceCents grande demais para o cálculo exato (recebido: ${priceCents})`);
  }

  const platformFeeCents = Math.floor(scaled / BPS_DENOMINATOR);
  return { platformFeeCents, inspectorPayoutCents: priceCents - platformFeeCents };
}
