import { ExponentialBackoffRetryPolicy } from './retry-policy';

describe('ExponentialBackoffRetryPolicy', () => {
  it('grows exponentially without jitter', () => {
    const p = new ExponentialBackoffRetryPolicy({
      baseDelayMs: 100,
      capMs: 10_000,
      jitterRatio: 0,
      random: () => 0.5,
    });
    expect(p.delayFor(1)).toBe(100);
    expect(p.delayFor(2)).toBe(200);
    expect(p.delayFor(3)).toBe(400);
    expect(p.delayFor(4)).toBe(800);
  });

  it('clamps at the cap', () => {
    const p = new ExponentialBackoffRetryPolicy({
      baseDelayMs: 1000,
      capMs: 2500,
      jitterRatio: 0,
      random: () => 0.5,
    });
    expect(p.delayFor(1)).toBe(1000);
    expect(p.delayFor(2)).toBe(2000);
    expect(p.delayFor(3)).toBe(2500);
    expect(p.delayFor(10)).toBe(2500);
  });

  it('applies jitter symmetrically', () => {
    const lowJ = new ExponentialBackoffRetryPolicy({
      baseDelayMs: 1000,
      capMs: 10_000,
      jitterRatio: 0.2,
      random: () => 0,
    });
    const highJ = new ExponentialBackoffRetryPolicy({
      baseDelayMs: 1000,
      capMs: 10_000,
      jitterRatio: 0.2,
      random: () => 1,
    });
    expect(lowJ.delayFor(1)).toBe(800);
    expect(highJ.delayFor(1)).toBe(1200);
  });

  it('exposes the default maxAttempts of 3', () => {
    expect(new ExponentialBackoffRetryPolicy().maxAttempts).toBe(3);
  });

  it('rejects attempt < 1', () => {
    const p = new ExponentialBackoffRetryPolicy();
    expect(() => p.delayFor(0)).toThrow();
  });
});
