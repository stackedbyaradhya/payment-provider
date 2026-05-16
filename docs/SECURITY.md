# Security & Compliance Notes

PCI scope, threat model, and what would change for a real production
deployment.

## What we do

- **PAN is encrypted at rest.** The plaintext PAN is read once from the
  request, validated with Luhn (`isLuhnValid`), brand-checked, encrypted with
  AES-256-GCM, and persisted to a separate `card_vault` table with a
  per-record IV and auth tag. The plaintext is then dropped. The cards table
  stores only non-sensitive metadata plus an opaque token.
- **PAN never leaves the vault.** The only code that decrypts is
  `PaymentsService.createPayment` immediately before calling the bank
  adapter; the plaintext lives for the duration of one method invocation.
  It never enters a log line, response body, exception, or metric.
- **No PAN in logs or errors.** Pino is configured with a `redact` block on
  `pan`, `cardNumber`, `card_number`, `cvv`, `cvc`, `authorization`, and
  passwords, both at the top level and inside `req.body`. The
  `GlobalExceptionFilter` additionally strips a deny-list of keys from any
  `details` object before returning a response, so a domain error throwing
  with `details: { pan: ... }` (which we never do) still wouldn't leak.
- **Tokens are opaque.** `tok_<32 random url-safe bytes>`. No information
  about the underlying card is encoded in the token; the only way to map a
  token back to a card is through the database, and only for the user who
  owns it.
- **User scoping is enforced everywhere.** The payments service does
  `cards.findByTokenForUser(userId, token)`; tokens are never resolved
  without checking ownership.
- **Passwords are argon2id.** Memory-hard, time-cost defaults from the
  argon2 library; min 12 chars with character-class checks. Login does a
  constant-time hash verify even when the email is unknown to avoid trivial
  user-enumeration timing.
- **Refresh tokens are hashed at rest** with SHA-256 and stored in a
  `refresh_tokens` table with `revoked_at`. Token rotation revokes the used
  token; refusing a revoked or expired token returns the same generic
  "Invalid refresh token" error.
- **Helmet, strict CORS, body-size limits**, and `ValidationPipe` with
  `whitelist: true, forbidNonWhitelisted: true` are all on.
- **Idempotency** prevents the same payment from being charged twice within
  24 hours; same-key + different-body returns 409.

## What would change in production

- **PCI scope minimisation via a tokenization gateway**. A real PSP doesn't
  receive raw PAN at its own infrastructure; it issues a hosted iframe / JS
  SDK / network token so the merchant only ever sees a token, which moves
  scope from PCI-DSS Level 1 down to SAQ-A. `KmsService` is the swap-in seam
  for that integration.
- **Real KMS-managed encryption keys.** The current implementation reads a
  32-byte key from `CARD_ENCRYPTION_KEY` env. In production: AWS KMS / GCP
  KMS / Vault Transit / an HSM-backed envelope-encryption scheme, with the
  data-encryption key generated per-record and the key-encryption key never
  exposed to application memory. The `keyVersion` column on `card_vault`
  already supports key rotation.
- **A real fraud / risk pipeline**: velocity checks, AVS, CVV result codes,
  3-D Secure step-up, device fingerprinting, BIN-allow / -block lists. None
  of this is implemented; the bank mock simply rolls a die.
- **mTLS to the issuer** for the real bank API; PCI requires it.
- **Audit access controls.** Today every authenticated user can see their
  own data; an admin/operator role would be needed for fraud review.
- **Vault-side ACLs**: card_vault rows should be readable only by a tightly
  scoped IAM role, and the decryption call should be auditable end to end.

## Threat-model bullets

- **Stolen DB dump**: PAN is encrypted with a key that lives outside the DB
  (in env / KMS). Attacker needs both the dump and the key.
- **Compromised application process**: attacker can decrypt cards while the
  process holds the key in memory. Mitigations would be: KMS-backed decrypt
  with rate limits and per-call audit, short-lived data keys, request-bound
  capability tokens. None of this is implemented here.
- **Replay**: idempotency keys are scoped per-user and a duplicate body
  replays the same response; a body mismatch is rejected with 409.
- **Brute-force on login**: argon2id hashing makes each guess expensive;
  rate limiter throttles attempts per IP. A real deployment would add
  account lockouts after N failures.
- **CSRF**: not relevant - we use bearer tokens, not cookies, and CORS is
  origin-allow-listed.
- **PAN exfiltration via error messages**: blocked by pino redact + the
  exception filter's denylist scrubber.
- **Tampered ciphertext**: AES-GCM auth tag verification fails closed
  (covered by a unit test in `kms.service.spec.ts`).
