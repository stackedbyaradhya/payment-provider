export interface RetryPolicy {
  readonly maxAttempts: number;
  delayFor(attempt: number): number;
}

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  capMs?: number;
  jitterRatio?: number;
  random?: () => number;
}

/**
 * Exponential backoff with full jitter band.
 *
 *   delay = clamp(base * 2^attempt, 0, cap) * (1 + uniform(-jitter, +jitter))
 *
 * `attempt` is the index of the upcoming retry: 1 for the first retry,
 * 2 for the second, etc. The initial bank call is *not* a retry.
 *
 * Defaults match the plan: base 200ms, cap 5s, +/-20% jitter, 3 retries max.
 */
export class ExponentialBackoffRetryPolicy implements RetryPolicy {
  readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly capMs: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;

  constructor(opts: RetryPolicyOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.baseDelayMs = opts.baseDelayMs ?? 200;
    this.capMs = opts.capMs ?? 5_000;
    this.jitterRatio = opts.jitterRatio ?? 0.2;
    this.random = opts.random ?? Math.random;
  }

  delayFor(attempt: number): number {
    if (attempt < 1) throw new Error('attempt must be >= 1');
    const exponential = Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.capMs);
    const jitter = (this.random() * 2 - 1) * this.jitterRatio;
    return Math.max(0, Math.round(exponential * (1 + jitter)));
  }
}
