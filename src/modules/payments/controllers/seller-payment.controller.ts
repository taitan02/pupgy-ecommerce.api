import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentAccountService } from '../services/payment-account.service.js';
import { PaymentAccountDto, UpsertPaymentAccountDto } from '../dto/payment.dto.js';
import { SHOP_HEADER, ShopGuard } from '../../../common/guards/shop.guard.js';
import { RequireAudience, RequireRoles } from '../../../common/decorators/auth.decorators.js';

/**
 * Where a merchant connects their own SePay account. Owner only: this decides which
 * bank account the shop's money lands in, which is not a staff decision.
 */
@ApiTags('seller/payments')
@ApiBearerAuth('access-token')
@ApiHeader({ name: SHOP_HEADER, required: true })
@RequireAudience('SELLER')
@UseGuards(ShopGuard)
@Controller('seller/payment-account')
export class SellerPaymentController {
  constructor(private readonly accounts: PaymentAccountService) {}

  @Get()
  @RequireRoles('OWNER')
  @ApiOperation({ summary: 'The shop’s bank details and webhook URL' })
  @ApiOkResponse({ type: PaymentAccountDto, description: 'null when not set up yet' })
  get(): Promise<PaymentAccountDto | null> {
    return this.accounts.get();
  }

  @Put()
  @RequireRoles('OWNER')
  @ApiOperation({
    summary: 'Create or update it',
    description:
      'The webhook secret is write-only: send it to set or rotate it, omit it to keep the stored one. It is never returned.',
  })
  @ApiOkResponse({ type: PaymentAccountDto })
  upsert(@Body() dto: UpsertPaymentAccountDto): Promise<PaymentAccountDto> {
    return this.accounts.upsert(dto);
  }
}
