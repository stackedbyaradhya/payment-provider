import request from 'supertest';

import { addCard, registerUser, rid } from './helpers/api';
import { bootE2E, E2EHandle, resetDb } from './helpers/app';

/**
 * Driving the mock bank deterministically.
 *
 * In e2e .env we set MOCK_BANK_DETERMINISTIC=true. The bank reads the
 * trailing `::OUTCOME` from the bank-side idempotency key, which is the
 * transaction id. To bias outcomes from the HTTP layer we instead encode
 * the desired outcome in the client-supplied Idempotency-Key. The deterministic
 * client falls back to that same suffix when the transaction id doesn't
 * contain it: we ensure the suffix is present in the txn id by listing
 * transactions before/after, but the simpler route is to assert behavior
 * through the deterministic default: with no suffix in the txn id the bank
 * returns SUCCESS. For failure paths we install a fresh app with seeded
 * outcomes via Prisma checks on resulting status only.
 */

describe('Payments happy path (e2e)', () => {
  let h: E2EHandle;
  beforeAll(async () => {
    h = await bootE2E();
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  it('creates a CAPTURED payment for a valid card', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    const idempotencyKey = rid('idem');
    const res = await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        cardToken: card.token,
        amountMinor: 2599,
        currency: 'USD',
        description: 'tee shirt',
      })
      .expect(201);
    expect(res.body.status).toBe('CAPTURED');
    expect(res.body.authorizationCode).toMatch(/^[0-9A-F]{8}$/);
    expect(res.body.attempts).toBe(1);

    // Idempotent replay
    const replay = await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        cardToken: card.token,
        amountMinor: 2599,
        currency: 'USD',
        description: 'tee shirt',
      });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(res.body.id);
  });

  it('rejects POST /payments without Idempotency-Key', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    const res = await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ cardToken: card.token, amountMinor: 100, currency: 'USD' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/Idempotency-Key/);
  });

  it('returns 409 on same key with different body', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    const idempotencyKey = rid('idem');
    await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ cardToken: card.token, amountMinor: 100, currency: 'USD' })
      .expect(201);
    const res = await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ cardToken: card.token, amountMinor: 200, currency: 'USD' });
    expect(res.status).toBe(409);
  });

  it("returns 404 when paying with another user's card token", async () => {
    const a = await registerUser(h.app);
    const b = await registerUser(h.app);
    const card = await addCard(h.app, a.accessToken);
    const res = await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .set('Idempotency-Key', rid('idem'))
      .send({ cardToken: card.token, amountMinor: 100, currency: 'USD' });
    expect(res.status).toBe(404);
  });

  it('fetches payment detail with state event history', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    const created = await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', rid('idem'))
      .send({ cardToken: card.token, amountMinor: 999, currency: 'USD' })
      .expect(201);
    const detail = await request(h.app.getHttpServer())
      .get(`/payments/${created.body.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    const states = detail.body.events.map((e: { toState: string }) => e.toState);
    expect(states).toEqual(['INITIATED', 'PROCESSING', 'AUTHORIZED', 'CAPTURED']);
  });

  it('exposes /metrics with payment counters and /metrics/summary with success rate', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', rid('idem'))
      .send({ cardToken: card.token, amountMinor: 100, currency: 'USD' })
      .expect(201);
    const metrics = await request(h.app.getHttpServer()).get('/metrics').expect(200);
    expect(metrics.text).toContain('payments_total');
    const summary = await request(h.app.getHttpServer()).get('/metrics/summary').expect(200);
    expect(summary.body.totalTransactions).toBeGreaterThan(0);
    expect(summary.body.successRate).toBeGreaterThan(0);
    expect(summary.body.avgPaymentDurationSeconds).toBeGreaterThanOrEqual(0);
  });
});
