import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Matches, MaxLength, Min } from 'class-validator';
import { CursorQueryDto } from '../../../common/dto/cursor-page.dto.js';

export class PaymentInstructionsDto {
  @ApiProperty({ description: 'VietQR image to show the buyer' }) qrImageUrl!: string;
  @ApiProperty({ example: 'Vietcombank' }) bankCode!: string;
  @ApiProperty() accountNumber!: string;
  @ApiProperty({ description: 'The platform, not the shop — funds are held until the order completes' })
  accountName!: string;
  @ApiProperty({ description: 'Integer VND — must match exactly' }) amount!: number;
  @ApiProperty({ description: 'What the buyer must put in the transfer memo' })
  reference!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ enum: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'] }) status!: string;
}

/** SePay's documented success contract: HTTP 200/201 with this body, within 30s. */
export class WebhookAckDto {
  @ApiProperty({ example: true }) success!: boolean;
}

export class PayoutAccountDto {
  @ApiProperty({ example: 'Vietcombank' }) bankCode!: string;
  @ApiProperty({ description: 'Masked — only the last four digits' }) accountNumberMasked!: string;
  @ApiProperty() accountName!: string;
}

export class UpsertPayoutAccountDto {
  @ApiProperty({ example: 'Vietcombank' })
  @IsString()
  @MaxLength(40)
  bankCode!: string;

  @ApiProperty({ example: '0010000000355' })
  @Matches(/^[0-9]{6,20}$/, { message: 'accountNumber must be 6–20 digits' })
  accountNumber!: string;

  @ApiProperty({ example: 'NGUYEN VAN A' })
  @IsString()
  @MaxLength(120)
  accountName!: string;
}

export class ShopBalanceDto {
  @ApiProperty({ description: 'Held until the orders behind it complete' }) pending!: number;
  @ApiProperty({
    description:
      'Withdrawable. Can be negative: COD money never reaches the platform, so the commission on it is a debt.',
  })
  available!: number;
}

export class LedgerEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['SHOP_PENDING', 'SHOP_AVAILABLE'] }) account!: string;
  @ApiProperty({ description: 'Signed integer VND' }) amount!: number;
  @ApiProperty({
    enum: [
      'ORDER_PAID',
      'ORDER_RELEASED',
      'ORDER_REFUNDED',
      'COD_COMMISSION_DUE',
      'PAYOUT_RESERVED',
      'PAYOUT_RETURNED',
    ],
  })
  reason!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) orderId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) payoutId!: string | null;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class LedgerPageDto {
  @ApiProperty({ type: [LedgerEntryDto] }) items!: LedgerEntryDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

export class PayoutDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() amount!: number;
  @ApiProperty({ enum: ['REQUESTED', 'PROCESSING', 'PAID', 'REJECTED'] }) status!: string;
  @ApiProperty() bankCode!: string;
  @ApiProperty({ description: 'Masked' }) accountNumberMasked!: string;
  @ApiProperty() accountName!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ format: 'date-time' }) requestedAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) settledAt!: string | null;
}

export class PayoutPageDto {
  @ApiProperty({ type: [PayoutDto] }) items!: PayoutDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

export class RequestPayoutDto {
  @ApiProperty({ minimum: 50_000, description: 'Integer VND, at most the available balance' })
  @IsInt()
  @Min(1)
  amount!: number;
}

export class FinanceQueryDto extends CursorQueryDto {}

