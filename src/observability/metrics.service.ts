import { Injectable, OnModuleInit } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Single source of truth for application metrics. `MetricsService` owns the
 * Prometheus `Registry`; both the `/metrics` text exposition endpoint and the
 * JSON `/metrics/summary` endpoint read from it so the two views agree.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests by route and status',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [this.registry],
  });

  readonly paymentsTotal = new Counter({
    name: 'payments_total',
    help: 'Total payment outcomes by terminal state',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  readonly paymentsDurationSeconds = new Histogram({
    name: 'payments_duration_seconds',
    help: 'End-to-end payment processing duration in seconds',
    labelNames: ['status'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30],
    registers: [this.registry],
  });

  readonly bankAttemptsTotal = new Counter({
    name: 'bank_attempts_total',
    help: 'Mock bank call outcomes',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  readonly bankRetriesTotal = new Counter({
    name: 'bank_retries_total',
    help: 'Total bank call retries performed',
    registers: [this.registry],
  });

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry, prefix: 'node_' });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  /**
   * Builds the JSON summary required by the assignment:
   * total transactions, success rate, average response time.
   * Reads directly from registered histograms/counters so the numbers can
   * never diverge from `/metrics`.
   */
  async summary(): Promise<{
    totalTransactions: number;
    success: number;
    failed: number;
    successRate: number;
    avgPaymentDurationSeconds: number;
  }> {
    const counterValues = await this.paymentsTotal.get();
    const histValues = await this.paymentsDurationSeconds.get();

    let success = 0;
    let failed = 0;
    let total = 0;
    for (const v of counterValues.values) {
      total += v.value;
      const status = v.labels.status;
      if (status === 'CAPTURED' || status === 'AUTHORIZED') success += v.value;
      if (status === 'FAILED') failed += v.value;
    }

    let sum = 0;
    let count = 0;
    for (const v of histValues.values) {
      if (v.metricName?.endsWith('_sum')) sum += v.value;
      if (v.metricName?.endsWith('_count')) count += v.value;
    }
    const avg = count > 0 ? sum / count : 0;
    const successRate = total > 0 ? success / total : 0;

    return {
      totalTransactions: total,
      success,
      failed,
      successRate,
      avgPaymentDurationSeconds: avg,
    };
  }
}
