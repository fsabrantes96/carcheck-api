import {
  DEFAULT_JWT_EXPIRES_IN_SECONDS,
  parseJwtExpiresInSeconds,
} from './jwt-config.js';

describe('parseJwtExpiresInSeconds', () => {
  it('usa 3600 quando a variável não está definida', () => {
    expect(parseJwtExpiresInSeconds(undefined)).toBe(3600);
    expect(DEFAULT_JWT_EXPIRES_IN_SECONDS).toBe(3600);
  });

  it.each([
    ['3600', 3600],
    ['1', 1],
    ['86400', 86400],
  ])('converte "%s" em %i', (value, expected) => {
    expect(parseJwtExpiresInSeconds(value)).toBe(expected);
  });

  it('aceita um número inteiro positivo já convertido', () => {
    expect(parseJwtExpiresInSeconds(900)).toBe(900);
  });

  it.each([
    ['texto', 'abc'],
    ['string vazia', ''],
    ['zero', '0'],
    ['negativo', '-60'],
    ['decimal', '3600.5'],
    ['notação científica', '1e3'],
    ['com unidade', '60s'],
    ['com espaços', ' 3600 '],
    ['acima do inteiro seguro', '9007199254740993'],
    ['número zero', 0],
    ['número decimal', 1.5],
    ['NaN', Number.NaN],
    ['null', null],
  ])('falha com mensagem clara para valor inválido (%s)', (_caso, value) => {
    expect(() => parseJwtExpiresInSeconds(value)).toThrow(
      `JWT_EXPIRES_IN_SECONDS inválido: ${JSON.stringify(value)}. ` +
        'Use um número inteiro positivo de segundos (ex.: 3600).',
    );
  });
});
