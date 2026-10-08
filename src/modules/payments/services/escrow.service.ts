import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../../generated/prisma/client.js';
import { LedgerRepository, type NewEntry } from '../repositories/ledger.repository.js';
import { logger } from '../../../infra/logger/logger.js';
import type { Env } from '../../../config/env.schema.js';

/** What the escrow needs to know about an order. Deliberately not the Prisma row. */
export interface SettleableOrder {
  id: string;
  shopId: string;
  total: number;
  itemsSubtotal: number;
  commissionRate: number;
  paymentMethod: 'COD' | 'SEPAY_QR';
}

/**
 * Where money changes hands.
 *
 * Every method takes a transaction, because a movement of money is never the only thing
 * happening — it accompanies an order changing state, and the two must commit together
 * or not at all. A ledger that is written in its own transaction is a ledger that can
 * disagree with the orders it describes.
 */
@Injectable()
export class EscrowService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The rate stamped onto new orders. Snapshotted so a later change is not retroactive. */
  currentRate(): number {
    return this.config.get('COMMISSION_RATE_BPS', { infer: true });
  }

  /**
   * Commission is charged on the goods, not on the shipping fee the shop pays a courier
   * out of. Rounded down, so rounding never invents money the platform did not earn.
   */
  commissionFor(order: SettleableOrder): number {
    return Math.floor((order.itemsSubtotal * order.commissionRate) / 10_000);
  }

  /** The buyer's money arrived. It belongs to the shop, but it is not theirs to spend
   *  yet — that is what escrow means (ADR-015). */
  async hold(tx: Prisma.TransactionClient, orders: SettleableOrder[]): Promise<void> {
    await this.ledger.post(
      tx,
      orders.map((order) => ({
        shopId: order.shopId,
        account: 'SHOP_PENDING' as const,
        amount: order.total,
        reason: 'ORDER_PAID' as const,
        orderId: order.id,
      })),
    );
  }

  /**
   * The order completed: the hold ends, commission is taken, the rest becomes
   * withdrawable.
   *
   * COD never passed through the platform, so there is nothing to move out of pending —
   * only the fee the shop now owes, which is a debit and may legitimately leave the
   * balance negative.
   */
  async release(tx: Prisma.TransactionClient, order: SettleableOrder): Promise<void> {
    if (await this.ledger.hasEntriesFor(order.id, 'ORDER_RELEASED', tx)) {
      // A second release would pay the shop twice. The order's `releasedAt` guards this
      // too; this is the guard that does not depend on the caller remembering.
      logger.warn({ orderId: order.id }, 'order already released, skipping');
      return;
    }

    const commission = this.commissionFor(order);
    const entries: NewEntry[] = [];

    if (order.paymentMethod === 'COD') {
      entries.push({
        shopId: order.shopId,
        account: 'SHOP_AVAILABLE',
        amount: -commission,
        reason: 'COD_COMMISSION_DUE',
        orderId: order.id,
      });
    } else {
      entries.push(
        {
          shopId: order.shopId,
          account: 'SHOP_PENDING',
          amount: -order.total,
          reason: 'ORDER_RELEASED',
          orderId: order.id,
        },
        {
          shopId: order.shopId,
          account: 'SHOP_AVAILABLE',
          amount: order.total - commission,
          reason: 'ORDER_RELEASED',
          orderId: order.id,
        },
      );
    }

    if (commission > 0) {
      entries.push({
        shopId: order.shopId,
        account: 'PLATFORM_REVENUE',
        amount: commission,
        reason: 'COMMISSION',
        orderId: order.id,
      });
    }

    await this.ledger.post(tx, entries);
  }

  /**
   * An order cancelled after it was paid for. The buyer gets their money back; where it
   * comes from depends on whether the shop has already been credited.
   *
   * COD has nothing to reverse: no money ever reached the platform.
   */
  async refund(
    tx: Prisma.TransactionClient,
    order: SettleableOrder,
    released: boolean,
  ): Promise<void> {
    if (order.paymentMethod === 'COD') return;
    if (await this.ledger.hasEntriesFor(order.id, 'ORDER_REFUNDED', tx)) return;

    await this.ledger.post(tx, [
      {
        shopId: order.shopId,
        account: released ? 'SHOP_AVAILABLE' : 'SHOP_PENDING',
        amount: -order.total,
        reason: 'ORDER_REFUNDED',
        orderId: order.id,
        note: released ? 'Hoàn tiền sau khi đã giải ngân' : undefined,
      },
    ]);
  }
}
