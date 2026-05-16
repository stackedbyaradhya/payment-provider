import {
  BankError,
  BankNetworkTimeoutError,
  BankRateLimitedError,
} from '@/modules/bank/domain/bank-client';

export interface Classification {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Single source of truth for which bank-side errors retry and which fail
 * permanently, exactly per the assignment's retry table.
 *
 * Retry on (network/temporary):
 *   - NETWORK_TIMEOUT
 *   - RATE_LIMITED (HTTP 429)
 *   - HTTP 5xx
 *   - CONNECTION_ERROR
 * Never retry on (business/permanent):
 *   - INSUFFICIENT_FUNDS
 *   - INVALID_CARD
 *   - CARD_EXPIRED
 *   - DECLINED
 *   - HTTP 4xx (except 429)
 */
export function classify(err: unknown): Classification {
  if (err instanceof BankError) {
    return {
      code: err.outcome,
      message: err.message,
      retryable: err.retryable,
    };
  }
  // Generic Node/HTTP errors. We don't currently call a real HTTP API for the
  // mock bank, but the classifier already speaks that language so that the
  // module is ready when a real adapter slots in.
  if (isNodeNetworkError(err)) {
    return {
      code: 'CONNECTION_ERROR',
      message: 'Connection error contacting bank',
      retryable: true,
    };
  }
  if (isHttpStatus(err)) {
    const status = err.status;
    if (status === 429) {
      return { code: 'RATE_LIMITED', message: 'Bank rate limit exceeded', retryable: true };
    }
    if (status >= 500) {
      return { code: `HTTP_${status}`, message: `Bank returned ${status}`, retryable: true };
    }
    if (status >= 400) {
      return { code: `HTTP_${status}`, message: `Bank returned ${status}`, retryable: false };
    }
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: err instanceof Error ? err.message : 'Unknown error',
    retryable: false,
  };
}

interface HasStatus {
  status: number;
}
function isHttpStatus(err: unknown): err is HasStatus {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Record<string, unknown>).status === 'number'
  );
}
function isNodeNetworkError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as Record<string, unknown>).code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND'
  );
}

export { BankNetworkTimeoutError, BankRateLimitedError };
