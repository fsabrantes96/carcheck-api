import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('conecta ao banco no onModuleInit', async () => {
    const service = new PrismaService();
    const connect = vi.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('fecha as conexões (e o pool do adapter-pg) no onApplicationShutdown', async () => {
    const service = new PrismaService();
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onApplicationShutdown();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
