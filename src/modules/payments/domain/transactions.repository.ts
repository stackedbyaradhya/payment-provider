import { Transaction, TransactionEvent, TransactionStatus } from './transaction.entity';

export interface CreateTransactionInput {
  userId: string;
  cardId: string;
  amountMinor: bigint;
  currency: string;
  description?: string | null;
  correlationId: string;
  /** Initial state; always 'INITIATED' from the service. */
  status: TransactionStatus;
}

export interface TransitionInput {
  transactionId: string;
  fromState: TransactionStatus;
  toState: TransactionStatus;
  reason: string;
  metadata?: Record<string, unknown> | null;
  attempts?: number;
  authorizationCode?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  correlationId: string;
}

export interface TransactionWithEvents extends Transaction {
  events: TransactionEvent[];
}

export abstract class TransactionsRepository {
  abstract create(input: CreateTransactionInput): Promise<Transaction>;

  /**
   * Persists a state transition atomically with a `transaction_events` row.
   * Implementations MUST run the row update and the event insert in the same
   * DB transaction so audit can never drift from state.
   */
  abstract transition(input: TransitionInput): Promise<Transaction>;

  abstract findByIdForUser(userId: string, id: string): Promise<TransactionWithEvents | null>;
  abstract listForUser(
    userId: string,
    pagination: { limit: number; cursor?: string },
  ): Promise<{ items: Transaction[]; nextCursor: string | null }>;
}
