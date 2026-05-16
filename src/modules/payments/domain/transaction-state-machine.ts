import { TransactionStatus } from './transaction.entity';

/**
 * The only place where allowed transitions are defined. Services never mutate
 * `transaction.status` directly; they call `assertTransition` and write a
 * `TransactionEvent` row inside the same DB transaction.
 */
const ALLOWED: ReadonlyMap<TransactionStatus, ReadonlySet<TransactionStatus>> = new Map([
  ['INITIATED', new Set<TransactionStatus>(['PROCESSING', 'FAILED'])],
  ['PROCESSING', new Set<TransactionStatus>(['AUTHORIZED', 'RETRYING', 'FAILED'])],
  ['RETRYING', new Set<TransactionStatus>(['PROCESSING', 'FAILED'])],
  ['AUTHORIZED', new Set<TransactionStatus>(['CAPTURED', 'FAILED'])],
  ['CAPTURED', new Set<TransactionStatus>()],
  ['FAILED', new Set<TransactionStatus>()],
]);

export class IllegalTransitionError extends Error {
  constructor(from: TransactionStatus, to: TransactionStatus) {
    super(`Illegal transaction state transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return ALLOWED.get(from)?.has(to) ?? false;
}

export function assertTransition(from: TransactionStatus, to: TransactionStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export function allowedNextStates(from: TransactionStatus): ReadonlySet<TransactionStatus> {
  return ALLOWED.get(from) ?? new Set();
}
