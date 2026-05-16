import { Module } from '@nestjs/common';

import { BankClient } from './domain/bank-client';
import { MockBankClient } from './infrastructure/mock-bank.client';
import { MathRandom, Random } from './infrastructure/random';
import { RealSleeper, Sleeper } from './infrastructure/sleeper';

@Module({
  providers: [
    { provide: Random, useClass: MathRandom },
    { provide: Sleeper, useClass: RealSleeper },
    { provide: BankClient, useClass: MockBankClient },
  ],
  exports: [BankClient],
})
export class BankModule {}
