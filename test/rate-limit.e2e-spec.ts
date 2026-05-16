import request from 'supertest';

import { addCard, registerUser } from './helpers/api';
import { bootE2E, E2EHandle, resetDb } from './helpers/app';

describe('Rate limit (e2e)', () => {
  let h: E2EHandle;
  // We boot the app with low limits via env overrides so this test is fast.
  const savedGeneral = process.env.RATE_LIMIT_GENERAL_LIMIT;
  beforeAll(async () => {
    process.env.RATE_LIMIT_GENERAL_LIMIT = '2';
    process.env.RATE_LIMIT_GENERAL_TTL_SECONDS = '60';
    h = await bootE2E();
  });
  afterAll(async () => {
    await h.close();
    if (savedGeneral !== undefined) {
      process.env.RATE_LIMIT_GENERAL_LIMIT = savedGeneral;
    } else {
      delete process.env.RATE_LIMIT_GENERAL_LIMIT;
    }
  });
  beforeEach(async () => {
    await resetDb(h.prisma);
  });

  it('throttles requests beyond the per-user limit', async () => {
    const user = await registerUser(h.app);
    await addCard(h.app, user.accessToken);
    const ok = await request(h.app.getHttpServer())
      .get('/cards')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(ok.status).toBe(200);
    const blocked = await request(h.app.getHttpServer())
      .get('/cards')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });
});
