/**
 * Bank-network adapter contract. Implementations live in `infrastructure/`;
 * everything above this line is provider-agnostic. The Payments domain only
 * depends on this interface and the error taxonomy below.
 */

export interface AuthorizationRequest {
  pan: string;
  expMonth: number;
  expYear: number;
  cardholderName: string;
  amountMinor: bigint;
  currency: string;
  /**
   * Stable identifier that the bank should treat as the idempotency anchor
   * for the authorization attempt. We use the transaction id so the bank
   * sees attempts for the same payment as related.
   */
  idempotencyKey: string;
  /** Free-form client reference. Carried through for traceability; in
   * deterministic test mode the mock bank also inspects this for an
   * `::OUTCOME` suffix so e2e tests can drive specific paths. */
  clientReference?: string;
}

export interface AuthorizationResult {
  authorizationCode: string;
  networkLatencyMs: number;
}

export type BankOutcome =
  | 'SUCCESS'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_CARD'
  | 'CARD_EXPIRED'
  | 'NETWORK_TIMEOUT'
  | 'RATE_LIMITED';

export abstract class BankClient {
  abstract authorize(req: AuthorizationRequest): Promise<AuthorizationResult>;
}

export class BankError extends Error {
  constructor(
    readonly outcome: Exclude<BankOutcome, 'SUCCESS'>,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'BankError';
  }
}

export class InsufficientFundsError extends BankError {
  constructor() {
    super('INSUFFICIENT_FUNDS', 'Insufficient funds', false);
  }
}
export class InvalidCardError extends BankError {
  constructor() {
    super('INVALID_CARD', 'Invalid card', false);
  }
}
export class CardExpiredError extends BankError {
  constructor() {
    super('CARD_EXPIRED', 'Card expired', false);
  }
}
export class BankNetworkTimeoutError extends BankError {
  constructor() {
    super('NETWORK_TIMEOUT', 'Bank network timeout', true);
  }
}
export class BankRateLimitedError extends BankError {
  constructor() {
    super('RATE_LIMITED', 'Bank rate limit exceeded', true);
  }
}
