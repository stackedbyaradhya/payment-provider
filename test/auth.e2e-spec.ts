import request from 'supertest';

import { registerUser, rid } from './helpers/api';
import { bootE2E, E2EHandle, resetDb } from './helpers/app';

describe('Auth (e2e)', () => {
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

  it('registers, logs in, and refreshes', async () => {
    const user = await registerUser(h.app);
    expect(user.accessToken).toBeDefined();

    const login = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    expect(login.body.tokens.accessToken).toBeDefined();

    const refresh = await request(h.app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(200);
    expect(refresh.body.accessToken).toBeDefined();
    expect(refresh.body.refreshToken).not.toBe(login.body.tokens.refreshToken);
  });

  it('rejects duplicate email', async () => {
    const email = `${rid('dup')}@test.local`;
    await request(h.app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'CorrectHorseBattery9!' })
      .expect(201);
    const res = await request(h.app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'CorrectHorseBattery9!' })
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('rejects weak passwords', async () => {
    const res = await request(h.app.getHttpServer())
      .post('/auth/register')
      .send({ email: `${rid('weak')}@test.local`, password: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects bad credentials', async () => {
    const user = await registerUser(h.app);
    const res = await request(h.app.getHttpServer())
      .post('/auth/login')
      .send({ email: user.email, password: 'WrongPassword9!' })
      .expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('round-trips the correlation id header', async () => {
    const id = 'test-correlation-id-1234';
    const res = await request(h.app.getHttpServer())
      .get('/healthz')
      .set('X-Correlation-Id', id)
      .expect(200);
    expect(res.header['x-correlation-id']).toBe(id);
  });

  it('rejects /me without auth', async () => {
    await request(h.app.getHttpServer()).get('/me').expect(401);
  });

  it('returns the user on /me with a valid token', async () => {
    const user = await registerUser(h.app);
    const res = await request(h.app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .expect(200);
    expect(res.body.email).toBe(user.email);
  });
});
