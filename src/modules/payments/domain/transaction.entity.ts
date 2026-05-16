export type TransactionStatus =
  | 'INITIATED'
  | 'PROCESSING'
  | 'RETRYING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED';

export const TERMINAL_STATES: ReadonlySet<TransactionStatus> = new Set(['CAPTURED', 'FAILED']);

export interface Transaction {
  id: string;
  userId: string;
  cardId: string;
  amountMinor: bigint;
  currency: string;
  description: string | null;
  status: TransactionStatus;
  authorizationCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  correlationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionEvent {
  id: string;
  transactionId: string;
  fromState: TransactionStatus | null;
  toState: TransactionStatus;
  reason: string;
  metadata: Record<string, unknown> | null;
  correlationId: string;
  createdAt: Date;
}
