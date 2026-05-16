import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AppConfig, CONFIG_TOKEN } from '@/config/configuration';
import {
  AuthorizationRequest,
  AuthorizationResult,
  BankClient,
  BankNetworkTimeoutError,
  BankOutcome,
  BankRateLimitedError,
  CardExpiredError,
  InsufficientFundsError,
  InvalidCardError,
} from '@/modules/bank/domain/bank-client';
import { MetricsService } from '@/observability/metrics.service';

import { Random } from './random';
import { Sleeper } from './sleeper';

interface WeightedOutcome {
  outcome: BankOutcome;
  weight: number;
}

/**
 * Distribution from the assignment:
 *   success 85, insufficient 8, invalid 2, expired 2, timeout 2, rate-limited 1.
 * The mapping lives here and only here so the percentages can't drift.
 */
const DISTRIBUTION: ReadonlyArray<WeightedOutcome> = [
  { outcome: 'SUCCESS', weight: 85 },
  { outcome: 'INSUFFICIENT_FUNDS', weight: 8 },
  { outcome: 'INVALID_CARD', weight: 2 },
  { outcome: 'CARD_EXPIRED', weight: 2 },
  { outcome: 'NETWORK_TIMEOUT', weight: 2 },
  { outcome: 'RATE_LIMITED', weight: 1 },
];

@Injectable()
export class MockBankClient extends BankClient {
  private readonly minLatency: number;
  private readonly maxLatency: number;
  private readonly deterministic: boolean;

  constructor(
    @Inject(CONFIG_TOKEN) config: AppConfig,
    private readonly random: Random,
    private readonly sleeper: Sleeper,
    private readonly metrics: MetricsService,
  ) {
    super();
    this.minLatency = config.mockBank.minLatencyMs;
    this.maxLatency = config.mockBank.maxLatencyMs;
    this.deterministic = config.mockBank.deterministic;
  }

  async authorize(req: AuthorizationRequest): Promise<AuthorizationResult> {
    const start = Date.now();
    const latency = this.computeLatency();
    const outcome = this.pickOutcome(req);

    await this.sleeper.sleep(latency);

    this.metrics.bankAttemptsTotal.inc({ outcome });

    if (outcome === 'SUCCESS') {
      return {
        authorizationCode: generateAuthCode(),
        networkLatencyMs: Date.now() - start,
      };
    }
    throw this.errorFor(outcome);
  }

  /**
   * In deterministic mode we read the outcome off the request's idempotency
   * key (e.g. trailing token "::INSUFFICIENT_FUNDS"). Tests use this to drive
   * exact outcome sequences without monkey-patching `Math.random`.
   */
  private pickOutcome(req: AuthorizationRequest): BankOutcome {
    if (this.deterministic) {
      for (const source of [req.idempotencyKey, req.clientReference ?? '']) {
        const m = source.match(/::([A-Z_]+)$/);
        if (m && DISTRIBUTION.some((d) => d.outcome === m[1])) {
          return m[1] as BankOutcome;
        }
      }
      return 'SUCCESS';
    }
    const totalWeight = DISTRIBUTION.reduce((s, w) => s + w.weight, 0);
    let r = this.random.next() * totalWeight;
    for (const w of DISTRIBUTION) {
      if (r < w.weight) return w.outcome;
      r -= w.weight;
    }
    return 'SUCCESS';
  }

  private computeLatency(): number {
    if (this.deterministic) return Math.min(this.maxLatency, 0);
    const span = this.maxLatency - this.minLatency;
    return this.minLatency + Math.floor(this.random.next() * (span + 1));
  }

  private errorFor(outcome: BankOutcome): Error {
    switch (outcome) {
      case 'INSUFFICIENT_FUNDS':
        return new InsufficientFundsError();
      case 'INVALID_CARD':
        return new InvalidCardError();
      case 'CARD_EXPIRED':
        return new CardExpiredError();
      case 'NETWORK_TIMEOUT':
        return new BankNetworkTimeoutError();
      case 'RATE_LIMITED':
        return new BankRateLimitedError();
      default:
        return new Error('Unexpected outcome');
    }
  }
}

function generateAuthCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}
