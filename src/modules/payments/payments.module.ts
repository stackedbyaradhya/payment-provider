import { Module } from '@nestjs/common';

import { BankModule } from '@/modules/bank/bank.module';
import { RealSleeper, Sleeper } from '@/modules/bank/infrastructure/sleeper';
import { CardsModule } from '@/modules/cards/cards.module';
import { IdempotencyModule } from '@/modules/idempotency/idempotency.module';

import { ExponentialBackoffRetryPolicy } from './domain/retry-policy';
import { TransactionsRepository } from './domain/transactions.repository';
import { PrismaTransactionsRepository } from './infrastructure/prisma-transactions.repository';
import { PaymentsController } from './payments.controller';
import { PaymentsService, RETRY_POLICY } from './payments.service';

@Module({
  imports: [CardsModule, BankModule, IdempotencyModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    { provide: TransactionsRepository, useClass: PrismaTransactionsRepository },
    { provide: RETRY_POLICY, useFactory: () => new ExponentialBackoffRetryPolicy() },
    { provide: Sleeper, useClass: RealSleeper },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
