import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { AuthModule } from './auth/auth.module.js';
import { InspectorsModule } from './inspectors/inspectors.module.js';
import { ListingsModule } from './listings/listings.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    InspectorsModule,
    ListingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
