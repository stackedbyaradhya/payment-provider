import { randomUUID } from 'node:crypto';

import { RequestContext } from '@/common/context/request-context';
import { EncryptedBlob, KmsService } from '@/crypto/kms.service';
import {
  BankClient,
  BankNetworkTimeoutError,
  BankRateLimitedError,
  CardExpiredError,
  InsufficientFundsError,
  InvalidCardError,
} from '@/modules/bank/domain/bank-client';
import { Sleeper } from '@/modules/bank/infrastructure/sleeper';
import { Card } from '@/modules/cards/domain/card.entity';
import { CardsRepository } from '@/modules/cards/domain/cards.repository';
import { MetricsService } from '@/observability/metrics.service';

import { ExponentialBackoffRetryPolicy } from './domain/retry-policy';
import { Transaction, TransactionEvent, TransactionStatus } from './domain/transaction.entity';
import { assertTransition } from './domain/transaction-state-machine';
import { TransactionsRepository } from './domain/transactions.repository';
import {
  CreateTransactionInput,
  TransactionWithEvents,
  TransitionInput,
} from './domain/transactions.repository';
import { PaymentsService } from './payments.service';

// ---- In-memory fakes ------------------------------------------------------

class InMemoryTransactionsRepository extends TransactionsRepository {
  private byId = new Map<string, Transaction>();
  private events: TransactionEvent[] = [];

  async create(input: CreateTransactionInput): Promise<Transaction> {
    const now = new Date();
    const tx: Transaction = {
      id: randomUUID(),
      userId: input.userId,
      cardId: input.cardId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: input.description ?? null,
      status: input.status,
      authorizationCode: null,
      errorCode: null,
      errorMessage: null,
      attempts: 0,
      correlationId: input.correlationId,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(tx.id, tx);
    this.events.push({
      id: randomUUID(),
      transactionId: tx.id,
      fromState: null,
      toState: input.status,
      reason: 'created',
      metadata: null,
      correlationId: input.correlationId,
      createdAt: now,
    });
    return tx;
  }

  async transition(input: TransitionInput): Promise<Transaction> {
    assertTransition(input.fromState, input.toState);
    const existing = this.byId.get(input.transactionId);
    if (!existing) throw new Error('not found');
    const updated: Transaction = {
      ...existing,
      status: input.toState,
      attempts: input.attempts ?? existing.attempts,
      authorizationCode: input.authorizationCode ?? existing.authorizationCode,
      errorCode: input.errorCode ?? existing.errorCode,
      errorMessage: input.errorMessage ?? existing.errorMessage,
      updatedAt: new Date(),
    };
    this.byId.set(updated.id, updated);
    this.events.push({
      id: randomUUID(),
      transactionId: updated.id,
      fromState: input.fromState,
      toState: input.toState,
      reason: input.reason,
      metadata: (input.metadata ?? null) as Record<string, unknown> | null,
      correlationId: input.correlationId,
      createdAt: new Date(),
    });
    return updated;
  }

  async findByIdForUser(userId: string, id: string): Promise<TransactionWithEvents | null> {
    const tx = this.byId.get(id);
    if (!tx || tx.userId !== userId) return null;
    return {
      ...tx,
      events: this.events.filter((e) => e.transactionId === id),
    };
  }

  async listForUser(): Promise<{ items: Transaction[]; nextCursor: string | null }> {
    return { items: [...this.byId.values()], nextCursor: null };
  }

  // Test helpers
  allEvents(txId: string) {
    return this.events.filter((e) => e.transactionId === txId);
  }
  toStates(txId: string): TransactionStatus[] {
    return this.allEvents(txId).map((e) => e.toState);
  }
}

class StubCardsRepository extends CardsRepository {
  private blob: EncryptedBlob = {
    ciphertext: Buffer.from('x'),
    iv: Buffer.alloc(12),
    authTag: Buffer.alloc(16),
    keyVersion: 1,
  };
  constructor(private readonly card: Card | null) {
    super();
  }
  async create(): Promise<Card> {
    throw new Error('not used');
  }
  async findByTokenForUser(): Promise<Card | null> {
    return this.card;
  }
  async listForUser(): Promise<Card[]> {
    return this.card ? [this.card] : [];
  }
  async softDelete(): Promise<boolean> {
    return true;
  }
  async getVaultBlobForUser(): Promise<EncryptedBlob | null> {
    return this.blob;
  }
}

class StubKms extends KmsService {
  readonly keyVersion = 1;
  encrypt(plaintext: string) {
    return {
      ciphertext: Buffer.from(plaintext),
      iv: Buffer.alloc(12),
      authTag: Buffer.alloc(16),
      keyVersion: 1,
    };
  }
  decrypt() {
    return '4242424242424242';
  }
}

class ScriptedBank extends BankClient {
  public calls = 0;
  constructor(private readonly script: Array<'OK' | Error>) {
    super();
  }
  async authorize() {
    const step = this.script[this.calls];
    this.calls += 1;
    if (step === 'OK' || step === undefined) {
      return { authorizationCode: 'AUTH123', networkLatencyMs: 1 };
    }
    throw step;
  }
}

class NoopSleeper extends Sleeper {
  async sleep() {
    /* no-op */
  }
}

const card: Card = {
  id: 'card-1',
  userId: 'user-1',
  token: 'tok_test',
  brand: 'VISA',
  last4: '4242',
  expMonth: 12,
  expYear: 2099,
  cardholderName: 'Jane Doe',
  createdAt: new Date(),
  deletedAt: null,
};

function buildService(bank: ScriptedBank, repo = new InMemoryTransactionsRepository()) {
  const service = new PaymentsService(
    repo,
    new StubCardsRepository(card),
    bank,
    new StubKms(),
    new NoopSleeper(),
    new MetricsService(),
    new ExponentialBackoffRetryPolicy({
      baseDelayMs: 0,
      capMs: 0,
      jitterRatio: 0,
      random: () => 0,
    }),
  );
  return { service, repo };
}

const dto = { cardToken: 'tok_test', amountMinor: 1000, currency: 'USD' } as const;

function run<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    RequestContext.run({ correlationId: 'corr-1' }, async () => {
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    });
  });
}

describe('PaymentsService', () => {
  it('captures on a successful first attempt', async () => {
    const bank = new ScriptedBank(['OK']);
    const { service, repo } = buildService(bank);
    const res = await run(() => service.createPayment('user-1', dto));
    expect(res.status).toBe('CAPTURED');
    expect(res.authorizationCode).toBe('AUTH123');
    expect(res.attempts).toBe(1);
    expect(bank.calls).toBe(1);
    expect(repo.toStates(res.id)).toEqual(['INITIATED', 'PROCESSING', 'AUTHORIZED', 'CAPTURED']);
  });

  it('fails immediately on a non-retryable error', async () => {
    const bank = new ScriptedBank([new InsufficientFundsError()]);
    const { service, repo } = buildService(bank);
    const res = await run(() => service.createPayment('user-1', dto));
    expect(res.status).toBe('FAILED');
    expect(res.errorCode).toBe('INSUFFICIENT_FUNDS');
    expect(res.attempts).toBe(1);
    expect(bank.calls).toBe(1);
    expect(repo.toStates(res.id)).toEqual(['INITIATED', 'PROCESSING', 'FAILED']);
  });

  it.each([new InvalidCardError(), new CardExpiredError()])('does not retry on %p', async (err) => {
    const bank = new ScriptedBank([err]);
    const { service } = buildService(bank);
    const res = await run(() => service.createPayment('user-1', dto));
    expect(res.status).toBe('FAILED');
    expect(bank.calls).toBe(1);
  });

  it('retries on network timeout and succeeds', async () => {
    const bank = new ScriptedBank([new BankNetworkTimeoutError(), 'OK']);
    const { service, repo } = buildService(bank);
    const res = await run(() => service.createPayment('user-1', dto));
    expect(res.status).toBe('CAPTURED');
    expect(bank.calls).toBe(2);
    // PROCESSING -> RETRYING -> PROCESSING -> AUTHORIZED -> CAPTURED
    expect(repo.toStates(res.id)).toEqual([
      'INITIATED',
      'PROCESSING',
      'RETRYING',
      'PROCESSING',
      'AUTHORIZED',
      'CAPTURED',
    ]);
  });

  it('retries on rate-limit then succeeds', async () => {
    const bank = new ScriptedBank([new BankRateLimitedError(), new BankRateLimitedError(), 'OK']);
    const { service } = buildService(bank);
    const res = await run(() => service.createPayment('user-1', dto));
    expect(res.status).toBe('CAPTURED');
    expect(bank.calls).toBe(3);
  });

  it('marks FAILED after retries are exhausted', async () => {
    const bank = new ScriptedBank([
      new BankNetworkTimeoutError(),
      new BankNetworkTimeoutError(),
      new BankNetworkTimeoutError(),
      new BankNetworkTimeoutError(),
    ]);
    const { service, repo } = buildService(bank);
    const res = await run(() => service.createPayment('user-1', dto));
    expect(res.status).toBe('FAILED');
    expect(res.errorCode).toBe('NETWORK_TIMEOUT');
    expect(res.attempts).toBe(4); // initial + 3 retries
    expect(bank.calls).toBe(4);
    // Final state path includes 3 RETRYING transitions.
    const events = repo.toStates(res.id);
    expect(events.filter((s) => s === 'RETRYING').length).toBe(3);
    expect(events[events.length - 1]).toBe('FAILED');
  });

  it('records reason and error code on each retrying transition', async () => {
    const bank = new ScriptedBank([new BankNetworkTimeoutError(), 'OK']);
    const { service, repo } = buildService(bank);
    const res = await run(() => service.createPayment('user-1', dto));
    const retryEvent = repo.allEvents(res.id).find((e) => e.toState === 'RETRYING');
    expect(retryEvent?.reason).toContain('NETWORK_TIMEOUT');
    expect(retryEvent?.metadata?.delayMs).toBeDefined();
  });
});
