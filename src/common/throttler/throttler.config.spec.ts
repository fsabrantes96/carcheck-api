import {
  AUTH_THROTTLE,
  THROTTLE_ERROR_MESSAGE,
  throttlerOptions,
} from './throttler.config.js';

describe('throttler.config', () => {
  describe('throttlerOptions (limite global)', () => {
    it('tem um único throttler "default" com 100 requisições a cada 60_000 ms', () => {
      expect(throttlerOptions).toMatchObject({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
      });
      expect(
        (throttlerOptions as { throttlers: unknown[] }).throttlers,
      ).toHaveLength(1);
    });

    it('usa a mensagem de erro em pt-BR', () => {
      expect(throttlerOptions).toMatchObject({
        errorMessage: THROTTLE_ERROR_MESSAGE,
      });
      expect(THROTTLE_ERROR_MESSAGE).toBe(
        'Muitas requisições. Tente novamente em instantes.',
      );
    });
  });

  describe('AUTH_THROTTLE (login e cadastro)', () => {
    it('sobrescreve só o throttler "default" com 5 requisições a cada 60_000 ms', () => {
      expect(AUTH_THROTTLE).toEqual({ default: { ttl: 60_000, limit: 5 } });
    });
  });
});
