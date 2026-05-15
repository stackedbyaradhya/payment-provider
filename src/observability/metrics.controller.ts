import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { MetricsService } from './metrics.service';

@ApiTags('observability')
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Service landing - points to docs, metrics, and health' })
  root() {
    return {
      service: 'payments-api',
      version: '0.1.0',
      docs: '/docs',
      health: '/healthz',
      metrics: '/metrics',
      metricsSummary: '/metrics/summary',
    };
  }

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Prometheus text exposition of all metrics' })
  async metricsText(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType());
    res.send(await this.metrics.render());
  }

  @Get('metrics/summary')
  @ApiOperation({
    summary: 'Summary metrics: total transactions, success rate, avg response time',
  })
  async metricsSummary() {
    return this.metrics.summary();
  }

  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe' })
  healthz() {
    return { status: 'ok' };
  }
}
