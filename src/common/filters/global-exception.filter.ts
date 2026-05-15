import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

import { RequestContext } from '@/common/context/request-context';
import { DomainError } from '@/common/errors/domain-error';

interface ErrorBody {
  code: string;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
}

/**
 * Translates errors into a stable JSON shape. Never leaks stack traces or
 * unknown internal details to clients. Card numbers and other sensitive
 * fields are kept out of `details` by construction (domain errors choose
 * what to include) and additionally pruned here.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = RequestContext.correlationId() ?? 'n/a';

    const { status, body } = this.toResponse(exception, correlationId);

    if (status >= 500) {
      this.logger.error(
        {
          err: exception,
          path: request.path,
          method: request.method,
          correlationId,
        },
        body.message,
      );
    } else {
      this.logger.warn({
        code: body.code,
        path: request.path,
        method: request.method,
        correlationId,
      });
    }

    response.status(status).json(body);
  }

  private toResponse(
    exception: unknown,
    correlationId: string,
  ): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        body: {
          code: exception.code,
          message: exception.message,
          correlationId,
          details: scrubDetails(exception.details),
        },
      };
    }
    if (exception instanceof ThrottlerException) {
      return {
        status: 429,
        body: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
          correlationId,
        },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message as string | string[] | undefined);
      const code = mapHttpCode(status);
      const flatMessage = Array.isArray(message)
        ? message.join('; ')
        : (message ?? exception.message);
      return {
        status,
        body: {
          code,
          message: flatMessage,
          correlationId,
          details:
            typeof res === 'object' && res !== null
              ? scrubDetails(res as Record<string, unknown>)
              : undefined,
        },
      };
    }
    return {
      status: 500,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        correlationId,
      },
    };
  }
}

const FORBIDDEN_KEYS = new Set([
  'pan',
  'cardnumber',
  'card_number',
  'number',
  'cvv',
  'cvc',
  'password',
  'passwordhash',
  'password_hash',
  'authorization',
  'token',
  'refreshtoken',
  'refresh_token',
  'accesstoken',
  'access_token',
]);

function scrubDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) continue;
    // These are framework-internal fields or duplicates of fields we already
    // surface at the top level of the response body.
    if (k === 'statusCode' || k === 'error' || k === 'message') continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapHttpCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}
