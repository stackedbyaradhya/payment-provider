import request from 'supertest';

import { addCard, registerUser, rid } from './helpers/api';
import { bootE2E, E2EHandle, resetDb } from './helpers/app';

describe('Payments failure & retry paths (e2e, deterministic bank)', () => {
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

  async function pay(token: string, cardToken: string, outcome: string) {
    return request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', rid('idem'))
      .send({
        cardToken,
        amountMinor: 1000,
        currency: 'USD',
        description: `::${outcome}`,
      });
  }

  it('non-retryable: INSUFFICIENT_FUNDS -> FAILED, 1 attempt', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    const res = await pay(user.accessToken, card.token, 'INSUFFICIENT_FUNDS');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.errorCode).toBe('INSUFFICIENT_FUNDS');
    expect(res.body.attempts).toBe(1);
  });

  it.each(['INVALID_CARD', 'CARD_EXPIRED'])('non-retryable: %s -> FAILED', async (outcome) => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    const res = await pay(user.accessToken, card.token, outcome);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.errorCode).toBe(outcome);
    expect(res.body.attempts).toBe(1);
  });

  it('retryable: NETWORK_TIMEOUT exhausts retries -> FAILED with 4 attempts', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    const res = await pay(user.accessToken, card.token, 'NETWORK_TIMEOUT');
    expect(res.body.status).toBe('FAILED');
    expect(res.body.errorCode).toBe('NETWORK_TIMEOUT');
    expect(res.body.attempts).toBe(4); // initial + 3 retries

    const detail = await request(h.app.getHttpServer())
      .get(`/payments/${res.body.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    const retrying = detail.body.events.filter(
      (e: { toState: string }) => e.toState === 'RETRYING',
    );
    expect(retrying).toHaveLength(3);
  });

  it('retryable: RATE_LIMITED exhausts retries -> FAILED', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    const res = await pay(user.accessToken, card.token, 'RATE_LIMITED');
    expect(res.body.status).toBe('FAILED');
    expect(res.body.errorCode).toBe('RATE_LIMITED');
  });

  it('does not retry on a body validation failure', async () => {
    const user = await registerUser(h.app);
    const res = await request(h.app.getHttpServer())
      .post('/payments')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', rid('idem'))
      .send({ cardToken: 'not-a-token', amountMinor: 100, currency: 'USD' });
    expect(res.status).toBe(400);
  });
});
