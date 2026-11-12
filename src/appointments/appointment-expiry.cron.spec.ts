import { Logger } from '@nestjs/common';
import { FakeClock } from '../../test/support/fake-clock.js';
import { AppointmentExpiryCron } from './appointment-expiry.cron.js';
import type { AppointmentExpiryService } from './appointment-expiry.service.js';

/** Promessa que o teste resolve ou rejeita quando quiser. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AppointmentExpiryCron', () => {
  const NOW = '2030-01-02T12:00:00.000Z';

  let clock: FakeClock;
  let expiry: { expireDue: ReturnType<typeof vi.fn> };
  let cron: AppointmentExpiryCron;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clock = new FakeClock(NOW);
    expiry = { expireDue: vi.fn().mockResolvedValue(0) };
    cron = new AppointmentExpiryCron(expiry as unknown as AppointmentExpiryService, clock);
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chama expireDue com a hora do relógio injetado', async () => {
    await cron.run();

    expect(expiry.expireDue).toHaveBeenCalledTimes(1);
    expect(expiry.expireDue).toHaveBeenCalledWith(new Date(NOW));
  });

  it('usa a hora do relógio no momento de cada execução', async () => {
    await cron.run();
    clock.advanceMinutes(1);
    await cron.run();

    expect(expiry.expireDue).toHaveBeenNthCalledWith(2, new Date('2030-01-02T12:01:00.000Z'));
  });

  it('pula a execução quando a anterior ainda não terminou', async () => {
    const pending = deferred<number>();
    expiry.expireDue.mockReturnValueOnce(pending.promise);

    const first = cron.run();
    await cron.run();

    expect(expiry.expireDue).toHaveBeenCalledTimes(1);
    pending.resolve(0);
    await first;
  });

  it('volta a executar depois que a anterior termina', async () => {
    const pending = deferred<number>();
    expiry.expireDue.mockReturnValueOnce(pending.promise);
    const first = cron.run();
    pending.resolve(0);
    await first;

    await cron.run();

    expect(expiry.expireDue).toHaveBeenCalledTimes(2);
  });

  it('não lança quando o serviço falha e registra o erro no log', async () => {
    const failure = new Error('banco fora do ar');
    expiry.expireDue.mockRejectedValue(failure);

    await expect(cron.run()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toEqual(['Falha ao expirar agendamentos vencidos', failure.stack]);
  });

  it('volta a executar depois de uma falha (a flag é liberada)', async () => {
    expiry.expireDue.mockRejectedValueOnce(new Error('falha'));
    await cron.run();

    await cron.run();

    expect(expiry.expireDue).toHaveBeenCalledTimes(2);
  });

  it('registra no log a quantidade expirada quando é maior que zero', async () => {
    expiry.expireDue.mockResolvedValue(2);

    await cron.run();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('2 agendamento(s) expirado(s)');
  });

  it('não registra nada no log quando nenhum agendamento expirou', async () => {
    await cron.run();

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
