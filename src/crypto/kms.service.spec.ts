import { randomBytes } from 'node:crypto';

import { AppConfig } from '@/config/configuration';

import { EnvKmsService } from './kms.service';

function buildConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [],
    database: { url: '' },
    jwt: {
      accessSecret: 'x',
      accessTtl: '15m',
      refreshSecret: 'y',
      refreshTtl: '7d',
    },
    cardEncryption: {
      keyBase64: randomBytes(32).toString('base64'),
      keyVersion: 1,
    },
    mockBank: { deterministic: true, minLatencyMs: 0, maxLatencyMs: 0 },
    rateLimit: {
      generalTtlSeconds: 60,
      generalLimit: 100,
      paymentsTtlSeconds: 60,
      paymentsLimit: 10,
    },
    idempotency: { ttlHours: 24 },
  };
}

describe('EnvKmsService', () => {
  it('round-trips arbitrary strings', () => {
    const kms = new EnvKmsService(buildConfig());
    for (const plaintext of ['4242424242424242', '371449635398431', 'a'.repeat(1024)]) {
      const blob = kms.encrypt(plaintext);
      expect(blob.iv).toHaveLength(12);
      expect(blob.authTag.length).toBeGreaterThan(0);
      expect(kms.decrypt(blob)).toBe(plaintext);
    }
  });

  it('fails closed when the auth tag is tampered with', () => {
    const kms = new EnvKmsService(buildConfig());
    const blob = kms.encrypt('4242424242424242');
    blob.authTag[0] ^= 0xff;
    expect(() => kms.decrypt(blob)).toThrow();
  });

  it('rejects unknown key versions instead of silently mis-decrypting', () => {
    const kms = new EnvKmsService(buildConfig());
    const blob = kms.encrypt('hello');
    expect(() => kms.decrypt({ ...blob, keyVersion: 999 })).toThrow(/Key version mismatch/);
  });

  it('rejects keys of the wrong length', () => {
    expect(
      () =>
        new EnvKmsService({
          ...buildConfig(),
          cardEncryption: { keyBase64: Buffer.from('short').toString('base64'), keyVersion: 1 },
        }),
    ).toThrow(/32 bytes/);
  });
});
