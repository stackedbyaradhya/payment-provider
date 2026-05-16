import { AppConfig } from '@/config/configuration';
import {
  BankNetworkTimeoutError,
  BankRateLimitedError,
  CardExpiredError,
  InsufficientFundsError,
  InvalidCardError,
} from '@/modules/bank/domain/bank-client';
import { MetricsService } from '@/observability/metrics.service';

import { MockBankClient } from './mock-bank.client';
import { Random } from './random';
import { Sleeper } from './sleeper';

class SequenceRandom extends Random {
  private i = 0;
  constructor(private readonly seq: number[]) {
    super();
  }
  next(): number {
    return this.seq[this.i++ % this.seq.length];
  }
}

class NoopSleeper extends Sleeper {
  async sleep() {
    /* no-op */
  }
}

function configFor(deterministic: boolean): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [],
    database: { url: '' },
    jwt: { accessSecret: 'x', accessTtl: '1m', refreshSecret: 'y', refreshTtl: '1m' },
    cardEncryption: {
      keyBase64: Buffer.alloc(32).toString('base64'),
      keyVersion: 1,
    },
    mockBank: { deterministic, minLatencyMs: 0, maxLatencyMs: 0 },
    rateLimit: {
      generalTtlSeconds: 60,
      generalLimit: 100,
      paymentsTtlSeconds: 60,
      paymentsLimit: 10,
    },
    idempotency: { ttlHours: 24 },
  };
}

const baseRequest = {
  pan: '4242424242424242',
  expMonth: 12,
  expYear: 2030,
  cardholderName: 'Jane Doe',
  amountMinor: 1000n,
  currency: 'USD',
  idempotencyKey: 'tx-1',
};

describe('MockBankClient', () => {
  it('returns success when r < 0.85', async () => {
    const bank = new MockBankClient(
      configFor(false),
      new SequenceRandom([0.0]),
      new NoopSleeper(),
      new MetricsService(),
    );
    const res = await bank.authorize(baseRequest);
    expect(res.authorizationCode).toMatch(/^[0-9A-F]{8}$/);
  });

  it('returns INSUFFICIENT_FUNDS in the 85-93% bucket', async () => {
    const bank = new MockBankClient(
      configFor(false),
      new SequenceRandom([0.9]),
      new NoopSleeper(),
      new MetricsService(),
    );
    await expect(bank.authorize(baseRequest)).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it('returns RATE_LIMITED at the tail', async () => {
    const bank = new MockBankClient(
      configFor(false),
      new SequenceRandom([0.999]),
      new NoopSleeper(),
      new MetricsService(),
    );
    await expect(bank.authorize(baseRequest)).rejects.toBeInstanceOf(BankRateLimitedError);
  });

  it('honours the deterministic suffix in idempotency key', async () => {
    const bank = new MockBankClient(
      configFor(true),
      new SequenceRandom([0]),
      new NoopSleeper(),
      new MetricsService(),
    );
    await expect(
      bank.authorize({ ...baseRequest, idempotencyKey: 'tx::NETWORK_TIMEOUT' }),
    ).rejects.toBeInstanceOf(BankNetworkTimeoutError);
    await expect(
      bank.authorize({ ...baseRequest, idempotencyKey: 'tx::CARD_EXPIRED' }),
    ).rejects.toBeInstanceOf(CardExpiredError);
    await expect(
      bank.authorize({ ...baseRequest, idempotencyKey: 'tx::INVALID_CARD' }),
    ).rejects.toBeInstanceOf(InvalidCardError);
    const ok = await bank.authorize({ ...baseRequest, idempotencyKey: 'tx-without-suffix' });
    expect(ok.authorizationCode).toMatch(/^[0-9A-F]{8}$/);
  });
});
