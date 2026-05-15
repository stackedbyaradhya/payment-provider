import { MetricsService } from './metrics.service';

describe('MetricsService.summary', () => {
  it('reports zeros before any transactions are recorded', async () => {
    const m = new MetricsService();
    const s = await m.summary();
    expect(s).toEqual({
      totalTransactions: 0,
      success: 0,
      failed: 0,
      successRate: 0,
      avgPaymentDurationSeconds: 0,
    });
  });

  it('computes success rate from CAPTURED + AUTHORIZED vs FAILED', async () => {
    const m = new MetricsService();
    m.paymentsTotal.inc({ status: 'CAPTURED' }, 8);
    m.paymentsTotal.inc({ status: 'AUTHORIZED' }, 1);
    m.paymentsTotal.inc({ status: 'FAILED' }, 1);
    const s = await m.summary();
    expect(s.totalTransactions).toBe(10);
    expect(s.success).toBe(9);
    expect(s.failed).toBe(1);
    expect(s.successRate).toBeCloseTo(0.9, 5);
  });

  it('computes average duration from the histogram', async () => {
    const m = new MetricsService();
    m.paymentsDurationSeconds.observe({ status: 'CAPTURED' }, 1);
    m.paymentsDurationSeconds.observe({ status: 'CAPTURED' }, 2);
    m.paymentsDurationSeconds.observe({ status: 'FAILED' }, 3);
    const s = await m.summary();
    expect(s.avgPaymentDurationSeconds).toBeCloseTo(2, 5);
  });

  it('exposes content type for Prometheus exposition', () => {
    const m = new MetricsService();
    expect(m.contentType()).toContain('text/plain');
  });
});
