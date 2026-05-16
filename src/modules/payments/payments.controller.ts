import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { IdempotencyInterceptor } from '@/modules/idempotency/idempotency.interceptor';

import { CreatePaymentDto, PaymentDetailDto, PaymentResponseDto } from './dto/payments.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique key per payment intent; replay-safe within 24h',
  })
  @ApiOperation({ summary: 'Create a payment (authorize + capture)' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.payments.createPayment(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment by id (includes state history)' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PaymentDetailDto> {
    return this.payments.getPayment(user.id, id);
  }

  @Get()
  @ApiOperation({ summary: 'List recent payments for the current user' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.payments.listPayments(user.id, limit, cursor);
  }
}
