import { AppointmentExpiryService } from './appointment-expiry.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

describe('AppointmentExpiryService', () => {
  const now = new Date('2030-01-02T12:00:00.000Z');

  let prisma: { appointment: { updateMany: ReturnType<typeof vi.fn> } };
  let service: AppointmentExpiryService;

  beforeEach(() => {
    prisma = { appointment: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) } };
    service = new AppointmentExpiryService(prisma as unknown as PrismaService);
  });

  describe('expireDue', () => {
    it('faz um único updateMany com os estados expiráveis e o prazo comparado ao now recebido', async () => {
      await service.expireDue(now);

      expect(prisma.appointment.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['REQUESTED', 'ACCEPTED', 'AWAITING_PAYMENT'] },
          expiresAt: { lte: now },
        },
        data: { status: 'EXPIRED', endedBy: 'SYSTEM', endedAt: now },
      });
    });

    it('nunca inclui PAID nem estados posteriores no filtro', async () => {
      await service.expireDue(now);

      const { where } = prisma.appointment.updateMany.mock.calls[0][0];
      for (const status of ['PAID', 'REPORT_SUBMITTED', 'DISPUTED', 'COMPLETED']) {
        expect(where.status.in).not.toContain(status);
      }
    });

    it('devolve quantos agendamentos expirou', async () => {
      await expect(service.expireDue(now)).resolves.toBe(3);
    });

    it('devolve 0 quando não há vencidos', async () => {
      prisma.appointment.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.expireDue(now)).resolves.toBe(0);
    });

    it('deixa o erro do banco subir (quem chama decide o que fazer)', async () => {
      const failure = new Error('banco fora do ar');
      prisma.appointment.updateMany.mockRejectedValue(failure);

      await expect(service.expireDue(now)).rejects.toBe(failure);
    });
  });
});
