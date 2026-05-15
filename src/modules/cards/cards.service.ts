import { Injectable } from '@nestjs/common';

import { NotFoundError, ValidationError } from '@/common/errors/domain-error';
import { KmsService } from '@/crypto/kms.service';
import { TokenGenerator } from '@/crypto/token.generator';

import { detectBrand, isPlausibleLength } from './domain/brand';
import { Card, isExpired } from './domain/card.entity';
import { CardsRepository } from './domain/cards.repository';
import { isLuhnValid } from './domain/luhn';
import { AddCardDto, CardResponseDto } from './dto/cards.dto';

@Injectable()
export class CardsService {
  constructor(
    private readonly repo: CardsRepository,
    private readonly kms: KmsService,
    private readonly tokens: TokenGenerator,
  ) {}

  async addCard(userId: string, dto: AddCardDto): Promise<CardResponseDto> {
    const pan = dto.number;
    if (!isPlausibleLength(pan)) throw new ValidationError('Card number length is invalid');
    if (!isLuhnValid(pan)) throw new ValidationError('Card number failed Luhn check');

    const brand = detectBrand(pan);
    if (brand === 'UNKNOWN') {
      throw new ValidationError('Unsupported card brand');
    }
    if (isExpired({ expMonth: dto.expMonth, expYear: dto.expYear })) {
      throw new ValidationError('Card is expired');
    }

    const last4 = pan.slice(-4);
    const blob = this.kms.encrypt(pan);
    const token = this.tokens.cardToken();

    const card = await this.repo.create({
      userId,
      token,
      brand,
      last4,
      expMonth: dto.expMonth,
      expYear: dto.expYear,
      cardholderName: dto.cardholderName.trim(),
      vault: blob,
    });
    return this.toDto(card);
  }

  async list(userId: string): Promise<CardResponseDto[]> {
    const cards = await this.repo.listForUser(userId);
    return cards.map((c) => this.toDto(c));
  }

  async remove(userId: string, token: string): Promise<void> {
    const removed = await this.repo.softDelete(userId, token);
    if (!removed) throw new NotFoundError('Card not found');
  }

  private toDto(card: Card): CardResponseDto {
    return {
      token: card.token,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      cardholderName: card.cardholderName,
      createdAt: card.createdAt.toISOString(),
    };
  }
}
