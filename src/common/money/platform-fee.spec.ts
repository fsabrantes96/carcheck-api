import { splitPlatformFee } from './platform-fee.js';

/** PRNG determinístico (mulberry32): mesma seed, mesma sequência. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Referência independente em BigInt: meio para cima. */
function referenceFee(priceCents: number, feeBps: number): number {
  return Number((BigInt(priceCents) * BigInt(feeBps) + 5000n) / 10000n);
}

const SEED = 20261111;
const CASES = 1000;

describe('splitPlatformFee', () => {
  describe('bordas', () => {
    it.each([
      // [preço, bps, comissão, repasse]
      [0, 1000, 0, 0],
      [1, 1000, 0, 1],
      [15000, 0, 0, 15000],
      [15000, 10000, 15000, 0],
      [1, 10000, 1, 0],
      [0, 0, 0, 0],
      [15000, 1000, 1500, 13500],
    ])('preço %i com %i bps: comissão %i e repasse %i', (price, bps, fee, payout) => {
      expect(splitPlatformFee(price, bps)).toEqual({
        platformFeeCents: fee,
        inspectorPayoutCents: payout,
      });
    });

    it('empate (1, 5000): 0,5 centavo arredonda para cima, comissão 1', () => {
      expect(splitPlatformFee(1, 5000)).toEqual({ platformFeeCents: 1, inspectorPayoutCents: 0 });
    });

    it('empate (3, 5000): 1,5 centavo arredonda para cima, comissão 2', () => {
      expect(splitPlatformFee(3, 5000)).toEqual({ platformFeeCents: 2, inspectorPayoutCents: 1 });
    });

    it('logo abaixo do empate arredonda para baixo (5555 com 1 bps = 0,5555 → 1; 4999 com 1 bps = 0,4999 → 0)', () => {
      expect(splitPlatformFee(5555, 1).platformFeeCents).toBe(1);
      expect(splitPlatformFee(4999, 1).platformFeeCents).toBe(0);
    });
  });

  describe('entradas inválidas', () => {
    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      'lança RangeError para priceCents = %s',
      (price) => {
        expect(() => splitPlatformFee(price, 1000)).toThrow(RangeError);
        expect(() => splitPlatformFee(price, 1000)).toThrow('priceCents deve ser um inteiro >= 0');
      },
    );

    it.each([-1, 10001, 0.5, Number.NaN])('lança RangeError para feeBps = %s', (bps) => {
      expect(() => splitPlatformFee(15000, bps)).toThrow(RangeError);
      expect(() => splitPlatformFee(15000, bps)).toThrow('feeBps deve ser um inteiro entre 0 e 10000');
    });

    it('lança RangeError quando price * bps sai da faixa de inteiros seguros', () => {
      expect(() => splitPlatformFee(Number.MAX_SAFE_INTEGER, 10000)).toThrow(
        'priceCents grande demais para o cálculo exato',
      );
    });
  });

  describe(`invariante com ${CASES} casos gerados (seed ${SEED})`, () => {
    const random = mulberry32(SEED);
    const cases = Array.from({ length: CASES }, (_, i) => {
      // Mistura preços pequenos (onde o arredondamento pesa) e grandes (até R$ 10 milhões).
      const max = i % 2 === 0 ? 10_000 : 1_000_000_000;
      return {
        price: Math.floor(random() * (max + 1)),
        bps: Math.floor(random() * 10_001),
      };
    });

    it('fee + payout === price, 0 <= fee <= price, inteiros e fee igual à referência em BigInt', () => {
      const failures: string[] = [];
      for (const { price, bps } of cases) {
        const { platformFeeCents: fee, inspectorPayoutCents: payout } = splitPlatformFee(price, bps);
        const ok =
          Number.isInteger(fee) &&
          Number.isInteger(payout) &&
          fee + payout === price &&
          fee >= 0 &&
          fee <= price &&
          fee === referenceFee(price, bps);
        if (!ok) failures.push(`(price=${price}, bps=${bps}) -> fee=${fee}, payout=${payout}`);
      }

      expect(failures, `seed ${SEED}: ${failures.slice(0, 5).join('; ')}`).toEqual([]);
    });

    it('o gerador não é degenerado (mais de 900 valores distintos de bps)', () => {
      const distinctBps = new Set(cases.map((c) => c.bps)).size;
      expect(distinctBps).toBeGreaterThan(900);
    });
  });
});
