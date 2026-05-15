import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const route = resolveRoute(context, req);
    const start = process.hrtime.bigint();
    const observe = (statusCode: number) => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      this.metrics.httpRequestsTotal.inc({
        method: req.method,
        route,
        status: String(statusCode),
      });
      this.metrics.httpRequestDurationSeconds.observe(
        { method: req.method, route, status: String(statusCode) },
        durationMs / 1000,
      );
    };
    return next.handle().pipe(
      tap({
        next: () => observe(res.statusCode),
        error: () => observe(res.statusCode || 500),
      }),
    );
  }
}

function resolveRoute(context: ExecutionContext, req: Request): string {
  const handler = context.getHandler();
  const controller = context.getClass();
  return `${controller.name}.${handler.name}` || req.path;
}
