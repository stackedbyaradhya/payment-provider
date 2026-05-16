import {
  BankNetworkTimeoutError,
  BankRateLimitedError,
  CardExpiredError,
  InsufficientFundsError,
  InvalidCardError,
} from '@/modules/bank/domain/bank-client';

import { classify } from './error-classifier';

describe('classify', () => {
  it.each([
    [new InsufficientFundsError(), 'INSUFFICIENT_FUNDS', false],
    [new InvalidCardError(), 'INVALID_CARD', false],
    [new CardExpiredError(), 'CARD_EXPIRED', false],
    [new BankNetworkTimeoutError(), 'NETWORK_TIMEOUT', true],
    [new BankRateLimitedError(), 'RATE_LIMITED', true],
  ] as const)('classifies %p as %s retryable=%s', (err, code, retryable) => {
    const c = classify(err);
    expect(c.code).toBe(code);
    expect(c.retryable).toBe(retryable);
  });

  it('treats node ECONNRESET as retryable CONNECTION_ERROR', () => {
    const err = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
    const c = classify(err);
    expect(c.code).toBe('CONNECTION_ERROR');
    expect(c.retryable).toBe(true);
  });

  it('treats HTTP 5xx as retryable', () => {
    const err = Object.assign(new Error('boom'), { status: 503 });
    expect(classify(err)).toEqual({
      code: 'HTTP_503',
      message: 'Bank returned 503',
      retryable: true,
    });
  });

  it('treats HTTP 4xx except 429 as non-retryable', () => {
    expect(classify(Object.assign(new Error(''), { status: 400 })).retryable).toBe(false);
    expect(classify(Object.assign(new Error(''), { status: 404 })).retryable).toBe(false);
    expect(classify(Object.assign(new Error(''), { status: 429 })).retryable).toBe(true);
  });

  it('flags unknown errors as non-retryable', () => {
    expect(classify(new Error('???')).retryable).toBe(false);
    expect(classify('not-an-error').retryable).toBe(false);
  });
});
