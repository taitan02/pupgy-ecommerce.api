import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class UpsertPaymentAccountDto {
  @ApiProperty({ example: 'Vietcombank', description: "SePay's short bank name" })
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

  @ApiPropertyOptional({
    minLength: 16,
    description:
      'The HMAC secret from SePay. Write-only: send it to set or rotate it, omit it to leave the stored one alone. It is never returned.',
  })
  @IsOptional()
  @IsString()
  @Length(16, 200)
  webhookSecret?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PaymentAccountDto {
  @ApiProperty() bankCode!: string;
  @ApiProperty({ description: 'Masked — only the last four digits' }) accountNumberMasked!: string;
  @ApiProperty() accountName!: string;
  @ApiProperty({
    description: 'Paste this into SePay as the webhook URL. It identifies the shop, nothing more.',
  })
  webhookUrl!: string;
  @ApiProperty({ description: 'Whether a secret has been stored. The secret itself is never sent back.' })
  hasSecret!: boolean;
  @ApiProperty() isActive!: boolean;
}

export class PaymentInstructionsDto {
  @ApiProperty({ description: 'VietQR image to show the buyer' }) qrImageUrl!: string;
  @ApiProperty({ example: 'Vietcombank' }) bankCode!: string;
  @ApiProperty() accountNumber!: string;
  @ApiProperty() accountName!: string;
  @ApiProperty({ description: 'Integer VND — must match exactly' }) amount!: number;
  @ApiProperty({ description: 'What the buyer must put in the transfer memo' })
  reference!: string;
  @ApiProperty({ format: 'date-time', description: 'After this the order is cancelled and restocked' })
  expiresAt!: string;
  @ApiProperty({ enum: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'] }) status!: string;
}

/** SePay's documented success contract: HTTP 200/201 with this body, within 30s. */
export class WebhookAckDto {
  @ApiProperty({ example: true }) success!: boolean;
}
