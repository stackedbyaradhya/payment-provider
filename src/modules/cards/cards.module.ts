import { Module } from '@nestjs/common';

import { CardsController } from './cards.controller';
import { CardsService } from './cards.service';
import { CardsRepository } from './domain/cards.repository';
import { PrismaCardsRepository } from './infrastructure/prisma-cards.repository';

@Module({
  controllers: [CardsController],
  providers: [CardsService, { provide: CardsRepository, useClass: PrismaCardsRepository }],
  exports: [CardsRepository, CardsService],
})
export class CardsModule {}
