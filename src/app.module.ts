import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BusinessRulesModule } from './config/business-rules.js';
import { validateEnv } from './config/env.validation.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { throttlerOptions } from './common/throttler/throttler.config.js';
import { AuthModule } from './auth/auth.module.js';
import { InspectorsModule } from './inspectors/inspectors.module.js';
import { ListingsModule } from './listings/listings.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    BusinessRulesModule,
    ThrottlerModule.forRoot(throttlerOptions),
    PrismaModule,
    AuthModule,
    InspectorsModule,
    ListingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
