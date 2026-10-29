import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { InspectorsModule } from './inspectors/inspectors.module.js';
import { ListingsModule } from './listings/listings.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, InspectorsModule, ListingsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
