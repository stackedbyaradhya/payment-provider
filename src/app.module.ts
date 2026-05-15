import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AppConfigModule } from './config/config.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuthModule } from './modules/auth/auth.module';
import { BankModule } from './modules/bank/bank.module';
import { CardsModule } from './modules/cards/cards.module';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { HttpMetricsInterceptor } from './observability/http-metrics.interceptor';
import { LoggerModule } from './observability/logger.module';
import { MetricsModule } from './observability/metrics.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    CryptoModule,
    MetricsModule,
    RateLimitModule,
    AuthModule,
    CardsModule,
    BankModule,
    IdempotencyModule,
    PaymentsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
