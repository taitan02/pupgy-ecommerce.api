import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PayoutService } from '../services/payout.service.js';
import {
  FinanceQueryDto,
  LedgerPageDto,
  PayoutAccountDto,
  PayoutDto,
  PayoutPageDto,
  RequestPayoutDto,
  ShopBalanceDto,
  UpsertPayoutAccountDto,
} from '../dto/payment.dto.js';
import { SHOP_HEADER, ShopGuard } from '../../../common/guards/shop.guard.js';
import { RequireAudience, RequireRoles } from '../../../common/decorators/auth.decorators.js';
import type { PayoutRecord } from '../repositories/payout.repository.js';

/**
 * The shop's money: what it is owed, where that came from, and getting it out.
 *
 * Owner only, all of it. A balance is commercially sensitive and a payout decides where
 * money physically goes — neither is a staff decision.
 */
@ApiTags('seller/finance')
@ApiBearerAuth('access-token')
@ApiHeader({ name: SHOP_HEADER, required: true })
@RequireAudience('SELLER')
@RequireRoles('OWNER')
@UseGuards(ShopGuard)
@Controller('seller/finance')
export class SellerFinanceController {
  constructor(private readonly payouts: PayoutService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Held and withdrawable balance, summed from the ledger' })
  @ApiOkResponse({ type: ShopBalanceDto })
  balance(): Promise<ShopBalanceDto> {
    return this.payouts.balance();
  }

  @Get('ledger')
  @ApiOperation({
    summary: 'Every movement of money, newest first',
    description: 'Append-only. A correction appears as its own opposite entry, never as an edit.',
  })
  @ApiOkResponse({ type: LedgerPageDto })
  async ledger(@Query() query: FinanceQueryDto): Promise<LedgerPageDto> {
    const rows = await this.payouts.history({ cursor: query.cursor, limit: query.limit });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map((row) => ({
        id: row.id,
        account: row.account,
        amount: row.amount,
        reason: row.reason,
        orderId: row.orderId,
        payoutId: row.payoutId,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? items.at(-1)!.id : null,
    };
  }

  @Get('payout-account')
  @ApiOperation({ summary: 'Where payouts are sent' })
  @ApiOkResponse({ type: PayoutAccountDto, description: 'null when not set up yet' })
  async payoutAccount(): Promise<PayoutAccountDto | null> {
    const account = await this.payouts.getAccount();
    if (!account) return null;
    return {
      bankCode: account.bankCode,
      accountNumberMasked: `••••${account.accountNumber.slice(-4)}`,
      accountName: account.accountName,
    };
  }

  @Put('payout-account')
  @ApiOperation({ summary: 'Set or change the destination bank account' })
  @ApiOkResponse({ type: PayoutAccountDto })
  async savePayoutAccount(@Body() dto: UpsertPayoutAccountDto): Promise<PayoutAccountDto> {
    const saved = await this.payouts.saveAccount(dto);
    return {
      bankCode: saved.bankCode,
      accountNumberMasked: `••••${saved.accountNumber.slice(-4)}`,
      accountName: saved.accountName,
    };
  }

  @Get('payouts')
  @ApiOperation({ summary: 'Past and pending withdrawals' })
  @ApiOkResponse({ type: PayoutPageDto })
  async listPayouts(@Query() query: FinanceQueryDto): Promise<PayoutPageDto> {
    const rows = await this.payouts.listPayouts({ cursor: query.cursor, limit: query.limit });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return { items: items.map(toPayoutDto), nextCursor: hasMore ? items.at(-1)!.id : null };
  }

  @Post('payouts')
  @ApiOperation({
    summary: 'Request a withdrawal',
    description:
      'The amount leaves the available balance immediately, so requesting twice cannot be paid twice.',
  })
  @ApiOkResponse({ type: PayoutDto })
  async requestPayout(@Body() dto: RequestPayoutDto): Promise<PayoutDto> {
    return toPayoutDto(await this.payouts.request(dto.amount));
  }
}

function toPayoutDto(payout: PayoutRecord): PayoutDto {
  return {
    id: payout.id,
    amount: payout.amount,
    status: payout.status,
    bankCode: payout.bankCode,
    accountNumberMasked: `••••${payout.accountNumber.slice(-4)}`,
    accountName: payout.accountName,
    note: payout.note,
    requestedAt: payout.requestedAt.toISOString(),
    settledAt: payout.settledAt?.toISOString() ?? null,
  };
}
