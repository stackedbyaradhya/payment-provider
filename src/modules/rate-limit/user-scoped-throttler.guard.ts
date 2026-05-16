import { createHash } from 'node:crypto';

import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
// Internal constant (not re-exported from the public surface in v6).
// We rely on its stable string value: 'THROTTLER:MODULE_OPTIONS'.
const THROTTLER_OPTIONS = 'THROTTLER:MODULE_OPTIONS';
import { AppConfig, CONFIG_TOKEN } from '@/config/configuration';

interface MaybeAuthedRequest {
  user?: { id?: string };
  ip?: string;
  ips?: string[];
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Keys throttling by authenticated user id when available, falling back to
 * the client IP otherwise.
 *
 * Subtle point: the global ThrottlerGuard runs *before* the controller-level
 * `JwtAuthGuard`, so by the time we get here `req.user` is still undefined.
 * To honour the spec ("per user"), we decode the bearer token ourselves with
 * the JWT secret. Tokens that fail verification simply fall through to IP.
 */
@Injectable()
export class UserScopedThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(THROTTLER_OPTIONS) options: ThrottlerModuleOptions,
    storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(CONFIG_TOKEN) private readonly appConfig: AppConfig,
  ) {
    super(options, storage, reflector);
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as MaybeAuthedRequest;
    if (r.user?.id) return `user:${r.user.id}`;
    const userIdFromJwt = this.extractUserIdFromAuthHeader(r);
    if (userIdFromJwt) return `user:${userIdFromJwt}`;
    const ip = (r.ips && r.ips.length > 0 ? r.ips[0] : r.ip) ?? 'anonymous';
    return `ip:${ip}`;
  }

  /**
   * Default `generateKey` includes class + handler names, which would make the
   * limit per route. We collapse to one bucket per user (or IP), matching
   * the assignment's intent of a per-user request budget.
   */
  protected generateKey(_context: ExecutionContext, tracker: string, name: string): string {
    return createHash('sha256').update(`${name}::${tracker}`).digest('hex');
  }

  private extractUserIdFromAuthHeader(r: MaybeAuthedRequest): string | undefined {
    const auth = r.headers?.['authorization'];
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (!value || typeof value !== 'string') return undefined;
    const match = value.match(/^Bearer\s+(.+)$/i);
    if (!match) return undefined;
    try {
      const payload = this.jwt.verify<{ sub?: string }>(match[1], {
        secret: this.appConfig.jwt.accessSecret,
      });
      return payload.sub;
    } catch {
      return undefined;
    }
  }
}
