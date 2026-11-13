import 'dotenv/config';
import { Injectable } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * Fecha as conexões no app.close() (e nos sinais de encerramento, como
   * SIGTERM e SIGINT, com o enableShutdownHooks do main.ts). O pool é criado pelo próprio adapter-pg
   * (recebe a configuração, não um pg.Pool), e é o $disconnect que o encerra.
   *
   * É o último hook do Nest: roda depois do beforeApplicationShutdown (que
   * para os crons) e do fechamento do servidor HTTP. No onModuleDestroy, uma
   * requisição ainda em andamento faria o Prisma reconectar com um pool novo,
   * que ninguém fecharia.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
