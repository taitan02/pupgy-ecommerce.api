import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AppError } from '../../../common/errors/app-error.js';
import { RequestContext } from '../../../common/context/request-context.js';
import { LedgerRepository } from '../repositories/ledger.repository.js';
import { PayoutRepository, type PayoutAccountRecord, type PayoutRecord } from '../repositories/payout.repository.js';

/** Below this it is not worth a bank transfer. */
const MIN_PAYOUT = 50_000;

@Injectable()
export class PayoutService {
  constructor(
    private readonly payouts: PayoutRepository,
    private readonly ledger: LedgerRepository,
  ) {}

  getAccount(): Promise<PayoutAccountRecord | null> {
    return this.payouts.findAccount();
  }

  async saveAccount(account: PayoutAccountRecord): Promise<PayoutAccountRecord> {
    return this.payouts.upsertAccount({
      id: uuidv7(),
      bankCode: account.bankCode.trim(),
      accountNumber: account.accountNumber.trim(),
      accountName: account.accountName.trim().toUpperCase(),
    });
  }

  balance() {
    return this.ledger.balanceOf(RequestContext.requireShopId());
  }

  history(params: { cursor?: string; limit: number }) {
    return this.ledger.list(RequestContext.requireShopId(), params);
  }

  listPayouts(params: { cursor?: string; limit: number }) {
    return this.payouts.listForShop(params);
  }

  /**
   * Asking for money. The bank details are copied onto the payout rather than
   * referenced, for the same reason an order copies its address: this is a record of
   * where money was sent, and editing the account later must not rewrite it.
   */
  async request(amount: number): Promise<PayoutRecord> {
    const shopId = RequestContext.requireShopId();

    const account = await this.payouts.findAccount();
    if (!account) throw AppError.conflict('Add a bank account before requesting a payout');
    if (amount < MIN_PAYOUT) {
      throw AppError.conflict(`The smallest payout is ${MIN_PAYOUT.toLocaleString('vi-VN')} ₫`);
    }

    const result = await this.payouts.request({
      id: uuidv7(),
      shopId,
      amount,
      account,
      // Read inside the transaction: a balance checked beforehand is a balance that can
      // change before the debit lands, and two requests in the same second would both
      // pass.
      availableInside: async (tx) => (await this.ledger.balanceOf(shopId, tx)).available,
      postReservation: (tx, payoutId) =>
        this.ledger.post(tx, [
          {
            shopId,
            account: 'SHOP_AVAILABLE',
            amount: -amount,
            reason: 'PAYOUT_RESERVED',
            payoutId,
          },
        ]),
    });

    if (result === 'insufficient') {
      const { available } = await this.ledger.balanceOf(shopId);
      throw AppError.conflict('Not enough available balance', { available });
    }
    return result;
  }
}
