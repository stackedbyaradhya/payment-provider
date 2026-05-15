import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

import { CardsService } from './cards.service';
import { AddCardDto, CardResponseDto } from './dto/cards.dto';

@ApiTags('cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Post()
  @ApiOperation({ summary: 'Save a new card and receive a payment token' })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCardDto): Promise<CardResponseDto> {
    return this.cards.addCard(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List saved cards for the current user' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<CardResponseDto[]> {
    return this.cards.list(user.id);
  }

  @Delete(':token')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a saved card' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ): Promise<void> {
    await this.cards.remove(user.id, token);
  }
}
