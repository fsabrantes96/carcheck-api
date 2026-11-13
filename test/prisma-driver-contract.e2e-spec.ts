import { HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import {
  isPrismaError,
  transactionConflictCode,
} from '../src/common/prisma/prisma-errors.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  closeTestApp,
  createTestApp,
  resetDatabase,
} from './support/test-app.js';

/**
 * Contrato do @prisma/adapter-pg com o Postgres real (riscos 27 e 50 do
 * docs/audit.md): o formato com que um deadlock chega à aplicação. Se um
 * upgrade do Prisma ou do adapter mudar esse formato, este teste falha antes
 * de o filtro global voltar a responder 500.
 *
 * O deadlock é forçado de forma determinística: duas transações travam uma
 * linha cada, esperam numa barreira até as duas terem o primeiro lock e então
 * pedem a linha da outra. O Postgres aborta uma delas com 40P01 depois do
 * deadlock_timeout (1 s por padrão). Não é o deadlock hipotético entre o job de
 * expiração e o accept, que depende da ordem interna de um UPDATE de várias
 * linhas e não é reproduzível de forma confiável.
 */
describe('Contrato do driver: deadlock (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(app);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  /** Promessa que só resolve quando as duas transações chegaram nela. */
  function barrier(parties: number): () => Promise<void> {
    let arrived = 0;
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return async () => {
      arrived += 1;
      if (arrived === parties) open();
      await opened;
    };
  }

  /**
   * Roda as duas transações em paralelo e devolve o erro da que o Postgres
   * abortou. Falha se nenhuma ou as duas falharem.
   */
  async function forceDeadlock(
    lock: (tx: Prisma.TransactionClient, key: 'a' | 'b') => Promise<unknown>,
  ): Promise<unknown> {
    const wait = barrier(2);
    const run = (first: 'a' | 'b', second: 'a' | 'b') =>
      prisma.$transaction(
        async (tx) => {
          await lock(tx, first);
          await wait();
          await lock(tx, second);
        },
        { timeout: 15_000 },
      );

    const results = await Promise.allSettled([run('a', 'b'), run('b', 'a')]);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    return rejected[0].reason;
  }

  async function twoUsers(): Promise<Record<'a' | 'b', string>> {
    const [a, b] = await Promise.all(
      ['a', 'b'].map((n) =>
        prisma.user.create({
          data: { name: n, email: `${n}@contrato.test`, passwordHash: 'x' },
        }),
      ),
    );
    return { a: a.id, b: b.id };
  }

  it('numa query de model, chega como P2034 com o SQLSTATE 40P01 no meta', async () => {
    const ids = await twoUsers();

    const error = await forceDeadlock((tx, key) =>
      tx.user.update({ where: { id: ids[key] }, data: { name: 'travado' } }),
    );

    expect(isPrismaError(error, 'P2034')).toBe(true);
    expect(transactionConflictCode(error)).toBe('40P01');
  });

  it('num $executeRaw, chega como P2010 com o SQLSTATE 40P01 no meta', async () => {
    const keys = { a: 1, b: 2 };

    const error = await forceDeadlock(
      (tx, key) =>
        tx.$executeRaw`SELECT pg_advisory_xact_lock(${keys[key]}::bigint)`,
    );

    expect(isPrismaError(error, 'P2010')).toBe(true);
    expect(transactionConflictCode(error)).toBe('40P01');
  });

  it('o erro real vira 409 no filtro global e é registrado com warn, não com error', async () => {
    const ids = await twoUsers();
    const error = await forceDeadlock((tx, key) =>
      tx.user.update({ where: { id: ids[key] }, data: { name: 'travado' } }),
    );
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      removeHeader: vi.fn(),
      headersSent: false,
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({
          url: '/appointments/x/accept',
          method: 'POST',
          route: { path: '/appointments/:id/accept' },
        }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(error, host);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Conflito ao processar, tente novamente',
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      'Conflito de transação (40P01) em POST /appointments/:id/accept',
    );
    expect(logError).not.toHaveBeenCalled();
  });
});
