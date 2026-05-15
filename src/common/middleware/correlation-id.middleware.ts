import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { RequestContext } from '@/common/context/request-context';

export const CORRELATION_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(CORRELATION_HEADER);
    const correlationId = isValidId(incoming) ? incoming! : uuidv4();
    res.setHeader(CORRELATION_HEADER, correlationId);
    (req as Request & { correlationId?: string }).correlationId = correlationId;
    RequestContext.run({ correlationId }, () => next());
  }
}

function isValidId(value: string | undefined): boolean {
  if (!value) return false;
  // Accept anything client-supplied but cap length and restrict characters.
  return value.length <= 128 && /^[A-Za-z0-9._\-:]+$/.test(value);
}
