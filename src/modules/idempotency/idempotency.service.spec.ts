import { Prisma } from '@prisma/client';

import { IdempotencyService } from './idempotency.service';

interface KeyRow {
  userId: string;
  key: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  transactionId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

class FakePrisma {
  rows = new Map<string, KeyRow>();
  idempotencyKey = {
    create: async ({
      data,
    }: {
      data: Omit<KeyRow, 'createdAt' | 'responseStatus' | 'responseBody' | 'transactionId'> &
        Partial<Pick<KeyRow, 'responseStatus' | 'responseBody' | 'transactionId'>>;
    }) => {
      const id = `${data.userId}::${data.key}`;
      if (this.rows.has(id)) {
        const err = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
          code: 'P2002',
          clientVersion: 'test',
        } as never);
        throw err;
      }
      this.rows.set(id, {
        userId: data.userId,
        key: data.key,
        requestHash: data.requestHash,
        responseStatus: data.responseStatus ?? null,
        responseBody: data.responseBody ?? null,
        transactionId: data.transactionId ?? null,
        createdAt: new Date(),
        expiresAt: data.expiresAt,
      });
    },
    findUnique: async ({ where }: { where: { userId_key: { userId: string; key: string } } }) => {
      return this.rows.get(`${where.userId_key.userId}::${where.userId_key.key}`) ?? null;
    },
    update: async ({
      where,
      data,
    }: {
      where: { userId_key: { userId: string; key: string } };
      data: Partial<KeyRow>;
    }) => {
      const id = `${where.userId_key.userId}::${where.userId_key.key}`;
      const existing = this.rows.get(id);
      if (!existing) throw new Error('not found');
      this.rows.set(id, { ...existing, ...data });
    },
    delete: async ({ where }: { where: { userId_key: { userId: string; key: string } } }) => {
      this.rows.delete(`${where.userId_key.userId}::${where.userId_key.key}`);
    },
  };
}

const config = { idempotency: { ttlHours: 24 } } as never;

describe('IdempotencyService', () => {
  let prisma: FakePrisma;
  let service: IdempotencyService;

  beforeEach(() => {
    prisma = new FakePrisma();
    service = new IdempotencyService(prisma as never, config);
  });

  it('rejects missing or malformed keys', async () => {
    await expect(service.reserve('u1', '', {})).rejects.toThrow(/Idempotency/);
    await expect(service.reserve('u1', 'bad space', {})).rejects.toThrow(/Idempotency/);
  });

  it('returns NEW on first use', async () => {
    const r = await service.reserve('u1', 'abcd1234', { a: 1 });
    expect(r.state).toBe('NEW');
  });

  it('returns REPLAYED after the response has been persisted', async () => {
    await service.reserve('u1', 'abcd1234', { a: 1 });
    await service.persistResponse('u1', 'abcd1234', 201, { id: 'tx-1', status: 'CAPTURED' });
    const r = await service.reserve('u1', 'abcd1234', { a: 1 });
    expect(r.state).toBe('REPLAYED');
    expect(r.cachedStatus).toBe(201);
    expect((r.cachedBody as { id: string }).id).toBe('tx-1');
  });

  it('returns IN_FLIGHT while a duplicate same-body request is concurrent', async () => {
    await service.reserve('u1', 'abcd1234', { a: 1 });
    const r = await service.reserve('u1', 'abcd1234', { a: 1 });
    expect(r.state).toBe('IN_FLIGHT');
  });

  it('throws CONFLICT on body mismatch', async () => {
    await service.reserve('u1', 'abcd1234', { a: 1 });
    await expect(service.reserve('u1', 'abcd1234', { a: 2 })).rejects.toThrow(
      /different request body/,
    );
  });

  it('release allows retry under the same key', async () => {
    await service.reserve('u1', 'abcd1234', { a: 1 });
    await service.release('u1', 'abcd1234');
    const r = await service.reserve('u1', 'abcd1234', { a: 1 });
    expect(r.state).toBe('NEW');
  });
});
