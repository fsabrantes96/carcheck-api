import { Reflector } from '@nestjs/core';
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import {
  THROTTLE_ERROR_MESSAGE,
  throttlerOptions,
} from '../common/throttler/throttler.config.js';
import { AuthController } from './auth.controller.js';

// Chaves de metadata usadas pelo @Throttle (o pacote não as exporta no index):
// node_modules/@nestjs/throttler/dist/throttler.constants.js
const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const THROTTLER_NAME = 'default';

type Handler = (...args: never[]) => unknown;

function handler(name: 'register' | 'login' | 'me'): Handler {
  return AuthController.prototype[name] as Handler;
}

describe('AuthController (rate limit)', () => {
  const reflector = new Reflector();

  describe('metadata do @Throttle', () => {
    it.each(['register', 'login'] as const)(
      '%s tem limit 5 para o throttler "default"',
      (name) => {
        expect(
          reflector.get(THROTTLER_LIMIT + THROTTLER_NAME, handler(name)),
        ).toBe(5);
      },
    );

    it.each(['register', 'login'] as const)(
      '%s tem ttl 60_000 ms para o throttler "default"',
      (name) => {
        expect(
          reflector.get(THROTTLER_TTL + THROTTLER_NAME, handler(name)),
        ).toBe(60_000);
      },
    );

    it('me não sobrescreve o limit (usa o limite global)', () => {
      expect(
        reflector.get(THROTTLER_LIMIT + THROTTLER_NAME, handler('me')),
      ).toBeUndefined();
    });

    it('me não sobrescreve o ttl (usa o limite global)', () => {
      expect(
        reflector.get(THROTTLER_TTL + THROTTLER_NAME, handler('me')),
      ).toBeUndefined();
    });

    it('a classe AuthController não tem @Throttle (a sobrescrita é só por rota)', () => {
      expect(
        reflector.get(THROTTLER_LIMIT + THROTTLER_NAME, AuthController),
      ).toBeUndefined();
    });
  });

  describe('ThrottlerGuard real com a configuração da aplicação', () => {
    let storage: ThrottlerStorageService;
    let guard: ThrottlerGuard;

    function context(
      name: 'register' | 'login' | 'me',
      ip = '203.0.113.10',
    ): ExecutionContext {
      const request = { ip, headers: {} };
      const response = { header: vi.fn() };
      return {
        getHandler: () => handler(name),
        getClass: () => AuthController,
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
        }),
      } as unknown as ExecutionContext;
    }

    async function hit(times: number, name: 'register' | 'login' | 'me') {
      for (let i = 0; i < times; i++) {
        await guard.canActivate(context(name));
      }
    }

    beforeEach(async () => {
      storage = new ThrottlerStorageService();
      guard = new ThrottlerGuard(throttlerOptions, storage, reflector);
      await guard.onModuleInit();
    });

    afterEach(() => {
      storage.onApplicationShutdown();
    });

    it.each(['register', 'login'] as const)(
      'libera as 5 primeiras requisições de um IP em %s',
      async (name) => {
        await expect(hit(5, name)).resolves.toBeUndefined();
      },
    );

    it.each(['register', 'login'] as const)(
      'bloqueia a 6ª requisição do mesmo IP em %s com ThrottlerException',
      async (name) => {
        await hit(5, name);

        await expect(guard.canActivate(context(name))).rejects.toBeInstanceOf(
          ThrottlerException,
        );
      },
    );

    it('a exceção de bloqueio usa a mensagem em pt-BR', async () => {
      await hit(5, 'login');

      await expect(guard.canActivate(context('login'))).rejects.toThrow(
        THROTTLE_ERROR_MESSAGE,
      );
    });

    it('não bloqueia outro IP quando um IP estourou o limite do login', async () => {
      await hit(5, 'login');

      await expect(
        guard.canActivate(context('login', '198.51.100.20')),
      ).resolves.toBe(true);
    });

    it('me continua liberado depois de 6 requisições (limite global de 100)', async () => {
      await hit(6, 'me');

      await expect(guard.canActivate(context('me'))).resolves.toBe(true);
    });
  });
});
