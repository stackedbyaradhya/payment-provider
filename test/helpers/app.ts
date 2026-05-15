import 'reflect-metadata';
import 'dotenv/config';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';

import { AppModule } from '@/app.module';
import { PrismaService } from '@/prisma/prisma.service';

export interface E2EHandle {
  app: INestApplication;
  prisma: PrismaService;
  close(): Promise<void>;
}

export async function bootE2E(): Promise<E2EHandle> {
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
  // E2E tests assume the mock bank is deterministic so outcomes can be
  // driven via the description suffix `::OUTCOME`. We force it here to keep
  // tests reproducible regardless of what the developer set in `.env`.
  process.env.MOCK_BANK_DETERMINISTIC = 'true';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  const prisma = app.get(PrismaService);
  return {
    app,
    prisma,
    async close() {
      await app.close();
    },
  };
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  // Order matters because of FK constraints.
  await prisma.idempotencyKey.deleteMany();
  await prisma.transactionEvent.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.card.deleteMany();
  await prisma.cardVault.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}
