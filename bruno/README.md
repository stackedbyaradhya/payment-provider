# Payments API - Bruno collection

A click-through demo of every endpoint and every requirement from the
assignment. Lives alongside the code so it never drifts.

## Open

1. Install [Bruno](https://www.usebruno.com) (free, open-source, runs locally;
   nothing in this collection is sent to a third party).
2. In Bruno: **Collection -> Open Collection** -> select `backend/bruno`.
3. Pick the **Local** environment (top-right) - it points at `http://localhost:3000`.
4. Make sure the API is running:

   ```bash
   cd backend
   docker compose up -d
   npx prisma migrate deploy
   npm run start:dev
   ```

5. For the deterministic failure tests in `03_Payments/` set
   `MOCK_BANK_DETERMINISTIC=true` in `backend/.env`. Without it the mock bank
   randomly picks an outcome (85% success) and the `::INSUFFICIENT_FUNDS` /
   `::NETWORK_TIMEOUT` requests won't reliably reproduce.

## Running the demo

The folders are ordered. Run them top-to-bottom either:

- **One at a time** in the UI - each request has assertions that turn green
  on success.
- **All at once** via **Run -> Run collection** - the entire suite executes
  end-to-end and the tests panel shows a pass/fail summary. This is the
  cleanest way to prove the system works in front of an audience.

If you run an authed request before logging in, the collection-level
pre-request script will fail fast with a clear message ("`accessToken` is
empty. Run 01_Auth/01_Register first...") rather than letting the server
return a generic 401.

The collection chains state via environment variables, all set automatically
by post-response scripts:

| Variable        | Set by                       | Used by                         |
|-----------------|------------------------------|---------------------------------|
| `demoEmail`     | collection pre-request       | Register, Login                 |
| `demoPassword`  | collection pre-request       | Register, Login                 |
| `accessToken`   | Register / Login / Refresh   | every authed request            |
| `refreshToken`  | Register / Login / Refresh   | Refresh                         |
| `userId`        | Register                     | Me (whoami)                     |
| `cardToken`     | Add Card (valid)             | every Payments request          |
| `idemKey`       | Pay Success / Insufficient.. | Replay-Same, Replay-Conflict    |
| `paymentId`     | Pay Success                  | (not used by other requests)    |
| `retryPaymentId`| Network Timeout              | Get Payment With Events         |

## What each folder proves

| Folder           | What you're showing                                             |
|------------------|-----------------------------------------------------------------|
| `00_Health`      | Service is up, has a self-describing root and a liveness probe. |
| `01_Auth`        | Register/login/refresh with rotating refresh tokens; argon2id; passwords are never echoed back. |
| `02_Cards`       | Luhn validation rejects bad PANs; valid card returns an opaque `tok_*` token plus only brand + last4 + expiry; PAN is never in any response. |
| `03_Payments`    | Happy path produces `CAPTURED`. Idempotent replay returns the same response with no second bank call. Same key + different body -> 409. Missing key -> 422. Non-retryable bank error fails after one attempt. Retryable error exhausts 4 attempts (initial + 3 retries with exponential backoff + jitter). The full state event audit trail is fetched and verified. |
| `04_Observability` | Prometheus exposition at `/metrics`, JSON summary at `/metrics/summary` (totals, success rate, avg duration), and end-to-end correlation-id propagation via `X-Correlation-Id`. |

## Tips for the live demo

- Open the **Tests** tab while running so the audience sees the assertions
  pass alongside the response.
- After running `01_Pay_Success`, switch to the **Headers** tab to point at
  the `Idempotency-Key` you sent and the matching one you'll reuse in the
  next two requests.
- After `06_Pay_Network_Timeout_Retries`, open `07_Get_Payment_With_Events`
  and expand the `events` array - this is the audit trail proving each
  RETRYING transition was written, not just counted.
- For the **rate limit** demonstration you can right-click any authed
  request (e.g. `02_Cards/03_List_Cards`) and pick **Run x times** -> 70.
  With `RATE_LIMIT_GENERAL_LIMIT=60` you'll see a clean transition from
  200s to 429s.
