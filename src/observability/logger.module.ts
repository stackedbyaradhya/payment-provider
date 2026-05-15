import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';

import { RequestContext } from '@/common/context/request-context';
import { CORRELATION_HEADER } from '@/common/middleware/correlation-id.middleware';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      useFactory: () => {
        const isProd = process.env.NODE_ENV === 'production';
        const level = process.env.LOG_LEVEL ?? 'info';
        return {
          pinoHttp: {
            level,
            // Use the correlation id we already produced in the middleware so
            // pino-http's reqId matches our X-Correlation-Id header.
            genReqId: (req: IncomingMessage, _res: ServerResponse): string => {
              const r = req as IncomingMessage & { correlationId?: string };
              if (r.correlationId) return r.correlationId;
              const fromHeader = r.headers[CORRELATION_HEADER];
              if (typeof fromHeader === 'string') return fromHeader;
              return uuidv4();
            },
            customProps: () => {
              const ctx = RequestContext.get();
              return {
                correlationId: ctx?.correlationId,
                userId: ctx?.userId,
                transactionId: ctx?.transactionId,
                service: 'payments-api',
              };
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-api-key"]',
                'req.body.password',
                'req.body.number',
                'req.body.pan',
                'req.body.cvv',
                'req.body.cvc',
                '*.password',
                '*.pan',
                '*.number',
                '*.cvv',
                '*.cvc',
                '*.cardNumber',
                '*.card_number',
              ],
              censor: '[REDACTED]',
            },
            serializers: {
              req: (req: { id?: string; method?: string; url?: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
            },
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    translateTime: 'SYS:HH:MM:ss.l',
                    ignore: 'pid,hostname,req,res,responseTime',
                  },
                },
            autoLogging: {
              ignore: (req) => req.url === '/healthz' || req.url === '/metrics',
            },
            customLogLevel: (_req, res, err) => {
              if (err || (res.statusCode ?? 0) >= 500) return 'error';
              if ((res.statusCode ?? 0) >= 400) return 'warn';
              return 'info';
            },
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
