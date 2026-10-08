import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { logger } from '../../../infra/logger/logger.js';
import { EscrowService, type SettleableOrder } from './escrow.service.js';
import type { Env } from '../../../config/env.schema.js';

const ORDER_FIELDS = {
  id: true,
  shopId: true,
  total: true,
  itemsSubtotal: true,
  commissionRate: true,
  paymentMethod: true,
} as const;

/**
 * Money leaving escrow.
 *
 * Completing an order and crediting the shop happen in one transaction, with
 * `released_at IS NULL` in the WHERE clause. That condition — not a check beforehand —
 * is what stops the buyer pressing "received" at the same moment the auto-release job
 * reaches the order and the shop being paid twice (ADR-015).
 */
@Injectable()
export class ReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly escrow: EscrowService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Completes one delivered order and releases its money. Returns false when somebody
   *  else got there first. */
  async complete(orderId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: 'DELIVERED', releasedAt: null },
        data: { status: 'COMPLETED', completedAt: new Date(), releasedAt: new Date() },
      });
      if (claimed.count === 0) return false;

      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: ORDER_FIELDS });
      await this.escrow.release(tx, order as SettleableOrder);
      return true;
    });
  }

  /**
   * Orders delivered longer ago than the window and still unreleased.
   *
   * Most buyers never press the button, and a shop's money cannot sit in escrow
   * because of that — so delivery starts a clock.
   */
  async autoRelease(limit = 200): Promise<number> {
    const days = this.config.get('AUTO_RELEASE_DAYS', { infer: true });
    const cutoff = new Date(Date.now() - days * 86_400_000);

    const due = await this.prisma.order.findMany({
      where: { status: 'DELIVERED', releasedAt: null, deliveredAt: { lt: cutoff } },
      orderBy: { deliveredAt: 'asc' },
      take: limit,
      select: { id: true },
    });

    let released = 0;
    for (const order of due) {
      if (await this.complete(order.id)) released += 1;
    }

    if (released > 0) logger.info({ released, days }, 'auto-released escrow after delivery');
    return released;
  }

  /** A cancellation that happens after the buyer has paid. Reverses the hold, or the
   *  credit if the money had already been released. */
  async refund(orderId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { ...ORDER_FIELDS, releasedAt: true, paymentStatus: true },
      });
      if (!order || order.paymentStatus !== 'PAID') return;

      await this.escrow.refund(tx, order as SettleableOrder, order.releasedAt !== null);
    });
  }
}
