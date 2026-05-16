# Transaction State Machine

## Allowed transitions

The full transition table from
[`transaction-state-machine.ts`](../src/modules/payments/domain/transaction-state-machine.ts):

| From       | Allowed `to`            | Caller                        | Typical `reason` |
| ---------- | ----------------------- | ----------------------------- | ---------------- |
| INITIATED  | PROCESSING              | PaymentsService               | `start authorization` |
| INITIATED  | FAILED                  | (reserved, e.g. pre-flight)   | `pre-flight rejection` |
| PROCESSING | AUTHORIZED              | PaymentsService               | `bank authorized` |
| PROCESSING | RETRYING                | PaymentsService               | `retry after <CODE>` |
| PROCESSING | FAILED                  | PaymentsService               | `non-retryable bank error` or `retries exhausted` |
| RETRYING   | PROCESSING              | PaymentsService               | `retry attempt` |
| RETRYING   | FAILED                  | (reserved for future)         | - |
| AUTHORIZED | CAPTURED                | PaymentsService               | `auto-capture` |
| AUTHORIZED | FAILED                  | (reserved: capture rejection) | - |
| CAPTURED   | -                       | terminal                      | - |
| FAILED     | -                       | terminal                      | - |

Any other pair throws `IllegalTransitionError` from `assertTransition`. This
is enforced both in the domain class and re-asserted inside
`PrismaTransactionsRepository.transition` before the DB write.

## Audit trail

Every transition produces a row in `transaction_events`:

```
id                uuid
transaction_id    uuid  (FK)
from_state        TEXT (null for the initial creation event)
to_state          TEXT
reason            TEXT (human-readable label)
metadata          JSONB (e.g. { attempt, delayMs, networkLatencyMs })
correlation_id    TEXT (matches X-Correlation-Id)
created_at        TIMESTAMP
```

The update of `transactions` and the insert into `transaction_events` happen
inside the **same Prisma transaction** so audit can never drift from state.

## Example event sequences

### Happy path

```
INITIATED  (created)
INITIATED  -> PROCESSING   reason="start authorization"
PROCESSING -> AUTHORIZED   reason="bank authorized"   metadata.networkLatencyMs=42
AUTHORIZED -> CAPTURED     reason="auto-capture"
```

### Non-retryable failure

```
INITIATED  (created)
INITIATED  -> PROCESSING   reason="start authorization"
PROCESSING -> FAILED       reason="non-retryable bank error"
                           errorCode="INSUFFICIENT_FUNDS"
```

### Retryable failure, recovered on retry 2

```
INITIATED  (created)
INITIATED  -> PROCESSING   reason="start authorization"
PROCESSING -> RETRYING     reason="retry after NETWORK_TIMEOUT"  metadata={attempt:1, delayMs:215}
RETRYING   -> PROCESSING   reason="retry attempt"                metadata={attempt:2}
PROCESSING -> AUTHORIZED   reason="bank authorized"
AUTHORIZED -> CAPTURED     reason="auto-capture"
```

### Retries exhausted

```
INITIATED  (created)
INITIATED  -> PROCESSING
PROCESSING -> RETRYING     reason="retry after NETWORK_TIMEOUT"  metadata={attempt:1, delayMs:215}
RETRYING   -> PROCESSING   reason="retry attempt"
PROCESSING -> RETRYING     reason="retry after NETWORK_TIMEOUT"  metadata={attempt:2, delayMs:412}
RETRYING   -> PROCESSING   reason="retry attempt"
PROCESSING -> RETRYING     reason="retry after NETWORK_TIMEOUT"  metadata={attempt:3, delayMs:892}
RETRYING   -> PROCESSING   reason="retry attempt"
PROCESSING -> FAILED       reason="retries exhausted"            errorCode="NETWORK_TIMEOUT"
```

## Retry classification reference

Single source of truth in
[`error-classifier.ts`](../src/modules/payments/domain/error-classifier.ts):

| Bank outcome / network condition | Retryable? | Code surfaced |
| --- | --- | --- |
| Successful authorization | n/a | (no error) |
| Insufficient funds | No | `INSUFFICIENT_FUNDS` |
| Invalid card | No | `INVALID_CARD` |
| Card expired | No | `CARD_EXPIRED` |
| Network timeout | Yes | `NETWORK_TIMEOUT` |
| Rate limited (bank-side / HTTP 429) | Yes | `RATE_LIMITED` |
| HTTP 5xx | Yes | `HTTP_5xx` |
| HTTP 4xx (except 429) | No | `HTTP_4xx` |
| `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `ENOTFOUND` | Yes | `CONNECTION_ERROR` |
| Anything else | No | `UNKNOWN_ERROR` |

Retry delay is exponential with jitter:

```
delay(attempt) = clamp(baseDelayMs * 2^(attempt-1), 0, capMs)
                 * (1 + uniform(-jitterRatio, +jitterRatio))
```

Defaults: `baseDelayMs=200`, `capMs=5_000`, `jitterRatio=0.2`, `maxAttempts=3`
(initial call + up to 3 retries = at most 4 bank calls).
