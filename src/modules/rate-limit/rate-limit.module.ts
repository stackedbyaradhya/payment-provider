import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppConfig, CONFIG_TOKEN } from '@/config/configuration';

import { UserScopedThrottlerGuard } from './user-scoped-throttler.guard';

/**
 * Rate limiting is in-memory (per process). The plan calls this out as a
 * deliberate trade-off: a Redis-backed `ThrottlerStorage` is the only thing
 * that needs to change to make this multi-instance correct.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [CONFIG_TOKEN],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.rateLimit.generalTtlSeconds * 1000,
            limit: config.rateLimit.generalLimit,
          },
        ],
      }),
    }),
    JwtModule.register({}),
  ],
  providers: [{ provide: APP_GUARD, useClass: UserScopedThrottlerGuard }],
})
export class RateLimitModule {}
