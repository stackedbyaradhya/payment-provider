import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { from, Observable, of, tap } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

import { AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { ConflictError, ValidationError } from '@/common/errors/domain-error';

import { IdempotencyService } from './idempotency.service';

const HEADER = 'idempotency-key';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly service: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: AuthenticatedUser }>();
    const res = http.getResponse<Response>();

    const key = (req.header(HEADER) ?? '').trim();
    if (!key) {
      throw new ValidationError('Idempotency-Key header is required');
    }
    if (!req.user?.id) {
      throw new ValidationError('Authentication is required for idempotent requests');
    }
    const userId = req.user.id;

    return from(this.service.reserve(userId, key, req.body)).pipe(
      mergeMap((lookup) => {
        if (lookup.state === 'REPLAYED') {
          res.status(lookup.cachedStatus ?? 200);
          return of(lookup.cachedBody);
        }
        if (lookup.state === 'IN_FLIGHT') {
          throw new ConflictError('A request with this Idempotency-Key is already being processed');
        }
        // NEW: run the handler and persist the response.
        return next.handle().pipe(
          tap({
            next: async (body) => {
              const txId = extractTransactionId(body);
              await this.service.persistResponse(userId, key, res.statusCode, body, txId);
            },
            error: async () => {
              // Release the slot so client retries (same body) get a fresh
              // shot. We don't keep error responses cached, otherwise we'd
              // permanently latch transient failures.
              await this.service.release(userId, key);
            },
          }),
        );
      }),
    );
  }
}

function extractTransactionId(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id?: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}
