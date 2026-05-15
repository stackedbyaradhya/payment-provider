import { Injectable } from '@nestjs/common';
import { Card as PrismaCard } from '@prisma/client';

import { EncryptedBlob } from '@/crypto/kms.service';
import { CardBrand } from '@/modules/cards/domain/brand';
import { Card } from '@/modules/cards/domain/card.entity';
import { CardsRepository, NewCardInput } from '@/modules/cards/domain/cards.repository';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PrismaCardsRepository extends CardsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: NewCardInput): Promise<Card> {
    const created = await this.prisma.$transaction(async (tx) => {
      const vault = await tx.cardVault.create({
        data: {
          ciphertext: input.vault.ciphertext,
          iv: input.vault.iv,
          authTag: input.vault.authTag,
          keyVersion: input.vault.keyVersion,
        },
      });
      return tx.card.create({
        data: {
          userId: input.userId,
          token: input.token,
          brand: input.brand,
          last4: input.last4,
          expMonth: input.expMonth,
          expYear: input.expYear,
          cardholderName: input.cardholderName,
          vaultId: vault.id,
        },
      });
    });
    return this.toDomain(created);
  }

  async findByTokenForUser(userId: string, token: string): Promise<Card | null> {
    const row = await this.prisma.card.findFirst({
      where: { token, userId, deletedAt: null },
    });
    return row ? this.toDomain(row) : null;
  }

  async listForUser(userId: string): Promise<Card[]> {
    const rows = await this.prisma.card.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDomain(r));
  }

  async softDelete(userId: string, token: string): Promise<boolean> {
    const result = await this.prisma.card.updateMany({
      where: { userId, token, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  async getVaultBlobForUser(userId: string, cardId: string): Promise<EncryptedBlob | null> {
    const row = await this.prisma.card.findFirst({
      where: { id: cardId, userId, deletedAt: null },
      select: {
        vault: {
          select: { ciphertext: true, iv: true, authTag: true, keyVersion: true },
        },
      },
    });
    if (!row?.vault) return null;
    return {
      ciphertext: Buffer.from(row.vault.ciphertext),
      iv: Buffer.from(row.vault.iv),
      authTag: Buffer.from(row.vault.authTag),
      keyVersion: row.vault.keyVersion,
    };
  }

  private toDomain(row: PrismaCard): Card {
    return {
      id: row.id,
      userId: row.userId,
      token: row.token,
      brand: row.brand as CardBrand,
      last4: row.last4,
      expMonth: row.expMonth,
      expYear: row.expYear,
      cardholderName: row.cardholderName,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    };
  }
}
