import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ example: 'tok_abc...' })
  @IsString()
  @Matches(/^tok_[A-Za-z0-9_-]{1,200}$/, { message: 'Invalid card token' })
  cardToken!: string;

  @ApiProperty({
    description: 'Amount in the smallest currency unit (e.g. cents)',
    example: 1999,
  })
  @Transform(({ value }) => (typeof value === 'string' ? Number(value) : value))
  @IsInt()
  @Min(1)
  amountMinor!: number;

  @ApiProperty({ example: 'USD', minLength: 3, maxLength: 3 })
  @IsString()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code' })
  currency!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

export class PaymentResponseDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  status!: string;
  @ApiProperty({ required: false, nullable: true })
  authorizationCode?: string | null;
  @ApiProperty({ required: false, nullable: true })
  errorCode?: string | null;
  @ApiProperty({ required: false, nullable: true })
  errorMessage?: string | null;
  @ApiProperty()
  attempts!: number;
  @ApiProperty()
  amountMinor!: number;
  @ApiProperty()
  currency!: string;
  @ApiProperty()
  createdAt!: string;
}

export class PaymentEventDto {
  @ApiProperty({ nullable: true })
  fromState!: string | null;
  @ApiProperty()
  toState!: string;
  @ApiProperty()
  reason!: string;
  @ApiProperty({ required: false, nullable: true })
  metadata?: Record<string, unknown> | null;
  @ApiProperty()
  createdAt!: string;
}

export class PaymentDetailDto extends PaymentResponseDto {
  @ApiProperty({ type: [PaymentEventDto] })
  events!: PaymentEventDto[];
}
