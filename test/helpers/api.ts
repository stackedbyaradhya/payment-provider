import { randomBytes } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';

export interface RegisteredUser {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  id: string;
}

export function rid(prefix = 'k'): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

export async function registerUser(app: INestApplication): Promise<RegisteredUser> {
  const email = `${rid('user')}@test.local`;
  const password = 'CorrectHorseBattery9!';
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  return {
    email,
    password,
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
    id: res.body.user.id,
  };
}

export async function addCard(
  app: INestApplication,
  token: string,
  number = '4242424242424242',
): Promise<{ token: string; brand: string; last4: string }> {
  const res = await request(app.getHttpServer())
    .post('/cards')
    .set('Authorization', `Bearer ${token}`)
    .send({
      number,
      expMonth: 12,
      expYear: 2099,
      cardholderName: 'Jane Doe',
    })
    .expect(201);
  return res.body;
}
