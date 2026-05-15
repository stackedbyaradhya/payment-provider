import request from 'supertest';

import { addCard, registerUser } from './helpers/api';
import { bootE2E, E2EHandle, resetDb } from './helpers/app';

describe('Cards (e2e)', () => {
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

  it('adds a card and never returns the PAN', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken, '4242424242424242');
    expect(card.token).toMatch(/^tok_/);
    expect(card.brand).toBe('VISA');
    expect(card.last4).toBe('4242');
    expect(JSON.stringify(card)).not.toContain('4242424242424242');
  });

  it('rejects PANs that fail Luhn', async () => {
    const user = await registerUser(h.app);
    const res = await request(h.app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        number: '4242424242424243',
        expMonth: 12,
        expYear: 2099,
        cardholderName: 'Jane Doe',
      })
      .expect(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/Luhn/);
  });

  it('rejects expired cards', async () => {
    const user = await registerUser(h.app);
    const res = await request(h.app.getHttpServer())
      .post('/cards')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        number: '4242424242424242',
        expMonth: 1,
        expYear: 2024,
        cardholderName: 'Jane Doe',
      })
      .expect(422);
    expect(res.body.message).toMatch(/expired/i);
  });

  it("lists only the current user's cards", async () => {
    const a = await registerUser(h.app);
    const b = await registerUser(h.app);
    await addCard(h.app, a.accessToken, '4242424242424242');
    await addCard(h.app, b.accessToken, '5555555555554444');

    const aList = await request(h.app.getHttpServer())
      .get('/cards')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .expect(200);
    expect(aList.body).toHaveLength(1);
    expect(aList.body[0].brand).toBe('VISA');

    const bList = await request(h.app.getHttpServer())
      .get('/cards')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    expect(bList.body).toHaveLength(1);
    expect(bList.body[0].brand).toBe('MASTERCARD');
  });

  it('soft-deletes a card', async () => {
    const user = await registerUser(h.app);
    const card = await addCard(h.app, user.accessToken);
    await request(h.app.getHttpServer())
      .delete(`/cards/${card.token}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(204);
    const list = await request(h.app.getHttpServer())
      .get('/cards')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 when deleting an unknown token', async () => {
    const user = await registerUser(h.app);
    await request(h.app.getHttpServer())
      .delete('/cards/tok_missing')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(404);
  });
});
