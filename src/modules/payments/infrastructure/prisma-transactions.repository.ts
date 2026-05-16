import { Injectable } from '@nestjs/common';
import {
  Transaction as PrismaTransaction,
  TransactionEvent as PrismaTransactionEvent,
  TransactionStatus as PrismaStatus,
} from '@prisma/client';

import {
  Transaction,
  TransactionEvent,
  TransactionStatus,
} from '@/modules/payments/domain/transaction.entity';
import { assertTransition } from '@/modules/payments/domain/transaction-state-machine';
import {
  CreateTransactionInput,
  TransactionsRepository,
  TransactionWithEvents,
  TransitionInput,
} from '@/modules/payments/domain/transactions.repository';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PrismaTransactionsRepository extends TransactionsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: CreateTransactionInput): Promise<Transaction> {
    const row = await this.prisma.transaction.create({
      data: {
        userId: input.userId,
        cardId: input.cardId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        description: input.description ?? null,
        status: input.status as PrismaStatus,
        correlationId: input.correlationId,
        attempts: 0,
        events: {
          create: {
            fromState: null,
            toState: input.status,
            reason: 'created',
            correlationId: input.correlationId,
          },
        },
      },
    });
    return this.toDomain(row);
  }

  async transition(input: TransitionInput): Promise<Transaction> {
    assertTransition(input.fromState, input.toState);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id: input.transactionId },
        data: {
          status: input.toState as PrismaStatus,
          attempts: input.attempts ?? undefined,
          authorizationCode: input.authorizationCode ?? undefined,
          errorCode: input.errorCode ?? undefined,
          errorMessage: input.errorMessage ?? undefined,
        },
      });
      // Defensive: if another worker raced past us, fail loudly.
      if (updated.status !== input.toState) {
        throw new Error('Concurrent modification of transaction state');
      }
      await tx.transactionEvent.create({
        data: {
          transactionId: input.transactionId,
          fromState: input.fromState,
          toState: input.toState,
          reason: input.reason,
          metadata: input.metadata as never,
          correlationId: input.correlationId,
        },
      });
      return this.toDomain(updated);
    });
  }

  async findByIdForUser(userId: string, id: string): Promise<TransactionWithEvents | null> {
    const row = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    const { events, ...rest } = row;
    return {
      ...this.toDomain(rest as PrismaTransaction),
      events: events.map((e) => this.toDomainEvent(e)),
    };
  }

  async listForUser(
    userId: string,
    pagination: { limit: number; cursor?: string },
  ): Promise<{ items: Transaction[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(pagination.limit, 1), 100);
    const rows = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: slice.map((r) => this.toDomain(r)),
      nextCursor: hasMore ? slice[slice.length - 1].id : null,
    };
  }

  private toDomain(row: PrismaTransaction): Transaction {
    return {
      id: row.id,
      userId: row.userId,
      cardId: row.cardId,
      amountMinor: row.amountMinor,
      currency: row.currency,
      description: row.description,
      status: row.status as TransactionStatus,
      authorizationCode: row.authorizationCode,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      attempts: row.attempts,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toDomainEvent(row: PrismaTransactionEvent): TransactionEvent {
    return {
      id: row.id,
      transactionId: row.transactionId,
      fromState: row.fromState as TransactionStatus | null,
      toState: row.toState as TransactionStatus,
      reason: row.reason,
      metadata: row.metadata as Record<string, unknown> | null,
      correlationId: row.correlationId,
      createdAt: row.createdAt,
    };
  }
}
