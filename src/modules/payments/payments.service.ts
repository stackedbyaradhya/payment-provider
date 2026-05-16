import { Inject, Injectable, Logger } from '@nestjs/common';

import { RequestContext } from '@/common/context/request-context';
import { NotFoundError, ValidationError } from '@/common/errors/domain-error';
import { KmsService } from '@/crypto/kms.service';
import { BankClient } from '@/modules/bank/domain/bank-client';
import { Sleeper } from '@/modules/bank/infrastructure/sleeper';
import { Card, isExpired } from '@/modules/cards/domain/card.entity';
import { CardsRepository } from '@/modules/cards/domain/cards.repository';
import { MetricsService } from '@/observability/metrics.service';

import { classify } from './domain/error-classifier';
import { RetryPolicy } from './domain/retry-policy';
import { Transaction } from './domain/transaction.entity';
import { TransactionsRepository, TransactionWithEvents } from './domain/transactions.repository';
import { CreatePaymentDto, PaymentDetailDto, PaymentResponseDto } from './dto/payments.dto';

export const RETRY_POLICY = Symbol('RetryPolicy');

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly transactions: TransactionsRepository,
    private readonly cards: CardsRepository,
    private readonly bank: BankClient,
    private readonly kms: KmsService,
    private readonly sleeper: Sleeper,
    private readonly metrics: MetricsService,
    @Inject(RETRY_POLICY) private readonly retryPolicy: RetryPolicy,
  ) {}

  async createPayment(userId: string, dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    const card = await this.cards.findByTokenForUser(userId, dto.cardToken);
    if (!card) throw new NotFoundError('Card not found for this user');
    if (isExpired(card)) {
      throw new ValidationError('Card is expired');
    }

    const correlationId = RequestContext.correlationId() ?? 'unknown';
    const initial = await this.transactions.create({
      userId,
      cardId: card.id,
      amountMinor: BigInt(dto.amountMinor),
      currency: dto.currency,
      description: dto.description ?? null,
      correlationId,
      status: 'INITIATED',
    });
    RequestContext.set('transactionId', initial.id);

    const blob = await this.cards.getVaultBlobForUser(userId, card.id);
    if (!blob) throw new NotFoundError('Card vault entry missing');
    const pan = this.kms.decrypt(blob);

    const start = process.hrtime.bigint();
    const finalTx = await this.runStateMachine(initial, card, pan);
    const elapsedSeconds = Number(process.hrtime.bigint() - start) / 1e9;

    this.metrics.paymentsTotal.inc({ status: finalTx.status });
    this.metrics.paymentsDurationSeconds.observe({ status: finalTx.status }, elapsedSeconds);

    return this.toResponse(finalTx);
  }

  async getPayment(userId: string, id: string): Promise<PaymentDetailDto> {
    const tx = await this.transactions.findByIdForUser(userId, id);
    if (!tx) throw new NotFoundError('Payment not found');
    return this.toDetail(tx);
  }

  async listPayments(
    userId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ items: PaymentResponseDto[]; nextCursor: string | null }> {
    const { items, nextCursor } = await this.transactions.listForUser(userId, { limit, cursor });
    return { items: items.map((t) => this.toResponse(t)), nextCursor };
  }

  /**
   * Drives a transaction from INITIATED through to a terminal state with
   * retries. The state machine guarantees we can never write an illegal
   * transition; every transition is paired with a `transaction_events` row.
   */
  private async runStateMachine(
    initial: Transaction,
    card: Card,
    pan: string,
  ): Promise<Transaction> {
    const correlationId = initial.correlationId;
    let tx = initial;
    let attempts = 0;

    // INITIATED -> PROCESSING (first attempt)
    tx = await this.transactions.transition({
      transactionId: tx.id,
      fromState: 'INITIATED',
      toState: 'PROCESSING',
      reason: 'start authorization',
      attempts,
      correlationId,
    });

    while (true) {
      attempts += 1;
      try {
        const auth = await this.bank.authorize({
          pan,
          expMonth: card.expMonth,
          expYear: card.expYear,
          cardholderName: card.cardholderName,
          amountMinor: tx.amountMinor,
          currency: tx.currency,
          idempotencyKey: tx.id,
          clientReference: tx.description ?? undefined,
        });
        // PROCESSING -> AUTHORIZED
        tx = await this.transactions.transition({
          transactionId: tx.id,
          fromState: 'PROCESSING',
          toState: 'AUTHORIZED',
          reason: 'bank authorized',
          attempts,
          authorizationCode: auth.authorizationCode,
          metadata: { networkLatencyMs: auth.networkLatencyMs, attempt: attempts },
          correlationId,
        });
        // AUTHORIZED -> CAPTURED (auto-capture; see README trade-off)
        tx = await this.transactions.transition({
          transactionId: tx.id,
          fromState: 'AUTHORIZED',
          toState: 'CAPTURED',
          reason: 'auto-capture',
          attempts,
          correlationId,
        });
        this.logger.log(
          { event: 'payment.captured', txId: tx.id, attempts, correlationId },
          'Payment captured',
        );
        return tx;
      } catch (err) {
        const c = classify(err);
        this.logger.warn(
          {
            event: 'payment.bank_error',
            txId: tx.id,
            attempt: attempts,
            code: c.code,
            retryable: c.retryable,
            correlationId,
          },
          `Bank attempt ${attempts} failed: ${c.code}`,
        );

        // `attempts` counts every bank call we just made. We are allowed up to
        // `maxAttempts` retries after the initial call, so total bank calls
        // can be `maxAttempts + 1`. The spec says "Maximum 3 retry attempts"
        // -> with the default policy that is 1 initial + 3 retries = 4 calls.
        const canRetry = c.retryable && attempts < this.retryPolicy.maxAttempts + 1;
        if (!canRetry) {
          // PROCESSING -> FAILED
          tx = await this.transactions.transition({
            transactionId: tx.id,
            fromState: 'PROCESSING',
            toState: 'FAILED',
            reason: c.retryable ? 'retries exhausted' : 'non-retryable bank error',
            attempts,
            errorCode: c.code,
            errorMessage: c.message,
            metadata: { attempt: attempts },
            correlationId,
          });
          return tx;
        }

        const delay = this.retryPolicy.delayFor(attempts);
        this.metrics.bankRetriesTotal.inc();
        // PROCESSING -> RETRYING (audit) -> PROCESSING (ready for next call)
        tx = await this.transactions.transition({
          transactionId: tx.id,
          fromState: 'PROCESSING',
          toState: 'RETRYING',
          reason: `retry after ${c.code}`,
          attempts,
          errorCode: c.code,
          errorMessage: c.message,
          metadata: { attempt: attempts, delayMs: delay },
          correlationId,
        });
        await this.sleeper.sleep(delay);
        tx = await this.transactions.transition({
          transactionId: tx.id,
          fromState: 'RETRYING',
          toState: 'PROCESSING',
          reason: 'retry attempt',
          attempts,
          metadata: { attempt: attempts + 1 },
          correlationId,
        });
      }
    }
  }

  private toResponse(tx: Transaction): PaymentResponseDto {
    return {
      id: tx.id,
      status: tx.status,
      authorizationCode: tx.authorizationCode,
      errorCode: tx.errorCode,
      errorMessage: tx.errorMessage,
      attempts: tx.attempts,
      amountMinor: Number(tx.amountMinor),
      currency: tx.currency,
      createdAt: tx.createdAt.toISOString(),
    };
  }

  private toDetail(tx: TransactionWithEvents): PaymentDetailDto {
    return {
      ...this.toResponse(tx),
      events: tx.events.map((e) => ({
        fromState: e.fromState,
        toState: e.toState,
        reason: e.reason,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}
