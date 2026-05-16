import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ConflictError, ValidationError } from '@/common/errors/domain-error';
import { AppConfig, CONFIG_TOKEN } from '@/config/configuration';
import { PrismaService } from '@/prisma/prisma.service';

export interface IdempotencyLookup {
  state: 'NEW' | 'IN_FLIGHT' | 'REPLAYED' | 'CONFLICT';
  cachedStatus?: number;
  cachedBody?: unknown;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG_TOKEN) config: AppConfig,
  ) {
    this.ttlMs = config.idempotency.ttlHours * 3600 * 1000;
  }

  /**
   * Validates the supplied key and reserves it for this request body.
   * Behavior:
   *  - NEW       -> first time we've seen the key for this user; reserved.
   *  - IN_FLIGHT -> same key + same body, no cached response yet (concurrent
   *                 caller still working); we surface a 409 so clients retry.
   *  - REPLAYED  -> same key + same body, cached response present; reuse it.
   *  - CONFLICT  -> same key + DIFFERENT body; reject with 409.
   */
  async reserve(userId: string, key: string, requestBody: unknown): Promise<IdempotencyLookup> {
    if (!isValidKey(key)) {
      throw new ValidationError('Idempotency-Key is missing or malformed');
    }
    const requestHash = hashBody(requestBody);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          userId,
          key,
          requestHash,
          expiresAt,
        },
      });
      return { state: 'NEW' };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Existing record. Decide whether it's a replay or a conflict.
        const existing = await this.prisma.idempotencyKey.findUnique({
          where: { userId_key: { userId, key } },
        });
        if (!existing) {
          // Race: deleted between insert and read.
          return { state: 'IN_FLIGHT' };
        }
        if (existing.expiresAt < new Date()) {
          await this.prisma.idempotencyKey.delete({
            where: { userId_key: { userId, key } },
          });
          return this.reserve(userId, key, requestBody);
        }
        if (existing.requestHash !== requestHash) {
          throw new ConflictError('Idempotency-Key already used with a different request body');
        }
        if (existing.responseStatus !== null && existing.responseBody !== null) {
          return {
            state: 'REPLAYED',
            cachedStatus: existing.responseStatus,
            cachedBody: existing.responseBody,
          };
        }
        return { state: 'IN_FLIGHT' };
      }
      throw err;
    }
  }

  async persistResponse(
    userId: string,
    key: string,
    statusCode: number,
    body: unknown,
    transactionId?: string,
  ): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { userId_key: { userId, key } },
      data: {
        responseStatus: statusCode,
        responseBody: body as never,
        transactionId: transactionId ?? null,
      },
    });
  }

  async release(userId: string, key: string): Promise<void> {
    // Called when a request failed before producing a stable response so the
    // client can retry the same key with the same body.
    await this.prisma.idempotencyKey
      .delete({ where: { userId_key: { userId, key } } })
      .catch(() => undefined);
  }
}

function isValidKey(key: string | undefined | null): key is string {
  if (!key) return false;
  return key.length >= 8 && key.length <= 128 && /^[A-Za-z0-9._\-:]+$/.test(key);
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
