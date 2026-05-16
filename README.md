# Payment Provider Backend

A NestJS + TypeScript + PostgreSQL implementation of the Payment Provider
assignment.

## Run it

```bash
cp .env.example .env
docker compose up -d                                  # Postgres on :5433
npm install
npx prisma migrate deploy                             # apply migrations
npm run start:dev                                     # http://localhost:3000
```

API docs: <http://localhost:3000/docs>
Metrics:  <http://localhost:3000/metrics>, <http://localhost:3000/metrics/summary>
Health:   <http://localhost:3000/healthz>

For a click-through demo, open the [Bruno collection](./bruno/README.md).

## Layout

Each feature module is split into `controller / service / domain /
infrastructure / dto`. The domain layer is plain TypeScript with no Nest or
Prisma imports. Full module map and request lifecycle in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Requirement → code map

| # | Requirement | Implementation |
| --- | --- | --- |
| A | User registration | `modules/auth/*` (argon2id, JWT access + refresh, rotation) |
| B | Card mgmt + Luhn | `modules/cards/*` (`domain/luhn.ts`, `domain/brand.ts`) |
| C | Tokenization | `tok_*` tokens; PAN in `card_vault` via `crypto/kms.service.ts` (AES-256-GCM) |
| D | Payments + mock bank | `modules/payments/*`, `modules/bank/*` (85/8/2/2/2/1 distribution, 100-3000 ms) |
| E | State machine | `payments/domain/transaction-state-machine.ts` + atomic `transaction_events` |
| F | Retries | `payments/domain/error-classifier.ts` + `retry-policy.ts` (exp backoff + jitter, max 3) |
| G | Security | pino redact, exception-filter scrub, argon2id, helmet, strict DTO validation |
| H1 | Idempotency | `Idempotency-Key` required on `POST /payments`; replay = cached, body mismatch = 409 |
| H2 | Rate limiting | `@nestjs/throttler`, per-user (JWT `sub` decoded inside the guard), IP fallback |
| H3 | Observability | correlation-id ALS, pino JSON, prom-client at `/metrics` and `/metrics/summary` |

## API surface

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/auth/register` | - |
| POST | `/auth/login` | - |
| POST | `/auth/refresh` | - |
| GET | `/me` | Bearer |
| POST | `/cards` | Bearer |
| GET | `/cards` | Bearer |
| DELETE | `/cards/:token` | Bearer |
| POST | `/payments` | Bearer + `Idempotency-Key` |
| GET | `/payments/:id` | Bearer |
| GET | `/payments` | Bearer |
| GET | `/metrics`, `/metrics/summary`, `/healthz` | - |

Full schemas at `/docs`.

## Trade-offs

- **Synchronous inline retries** instead of a job queue. Long-tail retry
  latency holds the HTTP connection; moving to BullMQ would touch only
  `payments.service.ts`.
- **App-managed AES-256-GCM vault** instead of a real KMS. `KmsService` is
  the swap-in seam. Not production-PCI - see `docs/SECURITY.md`.
- **In-memory rate limiter.** Needs Redis to be correct under horizontal
  scale.
- **Auto-capture after authorize.** The state machine already permits a
  separate `AUTHORIZED -> CAPTURED` step if you want to split them.
- **Prisma over TypeORM.** Domain layer is Prisma-free behind repository
  interfaces, so the choice is reversible.

## Tests

```bash
npm test            # unit tests, no DB
npm run test:e2e    # e2e tests, real Postgres via docker compose
```

Unit specs cover Luhn, KMS round-trip and tampering, the state machine, the
error classifier, the retry policy, the mock bank distribution, idempotency,
and the payments service against a scripted bank. E2e specs hit every
endpoint and every retry / failure path.

## Environment variables

Full list in [.env.example](./.env.example). The ones worth knowing:

- `CARD_ENCRYPTION_KEY` - base64-encoded 32 bytes (AES-256). Generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` - long random strings, distinct.
- `MOCK_BANK_DETERMINISTIC` - `true` for tests (description suffix
  `::OUTCOME` drives the result); `false` for the random distribution.
- `RATE_LIMIT_GENERAL_LIMIT` / `RATE_LIMIT_GENERAL_TTL_SECONDS` - per-user
  budget.

## Further reading

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - module map + request lifecycle
- [docs/SECURITY.md](./docs/SECURITY.md) - PCI posture, threat model, KMS swap point
- [docs/STATE-MACHINE.md](./docs/STATE-MACHINE.md) - transition table + example event rows
