import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class AddCardDto {
  @ApiProperty({ example: '4242424242424242', description: 'PAN; 12-19 digits' })
  @IsString()
  @Matches(/^\d{12,19}$/, { message: 'number must be 12-19 digits' })
  number!: string;

  @ApiProperty({ minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  expMonth!: number;

  @ApiProperty({ minimum: 2024, maximum: 2099 })
  @IsInt()
  @Min(2024)
  @Max(2099)
  expYear!: number;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  cardholderName!: string;
}

export class CardResponseDto {
  @ApiProperty()
  token!: string;
  @ApiProperty({ example: 'VISA' })
  brand!: string;
  @ApiProperty({ example: '4242' })
  last4!: string;
  @ApiProperty()
  expMonth!: number;
  @ApiProperty()
  expYear!: number;
  @ApiProperty()
  cardholderName!: string;
  @ApiProperty()
  createdAt!: string;
}
