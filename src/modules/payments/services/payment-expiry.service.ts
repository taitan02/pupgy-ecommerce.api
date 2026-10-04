import { Injectable } from '@nestjs/common';
import { logger } from '../../../infra/logger/logger.js';
import { OrderService } from '../../orders/services/order.service.js';
import { PaymentService } from './payment.service.js';

/**
 * Closing the window on an order nobody paid for.
 *
 * Both the per-order delayed job and the periodic sweeper land here, so the decision
 * lives once. It is safe to run twice: `markExpired` carries the current status in its
 * WHERE clause, so a transfer that arrived a moment ago wins and this does nothing.
 */
@Injectable()
export class PaymentExpiryService {
  constructor(
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
  ) {}

  async expireOrder(orderId: string): Promise<void> {
    const payment = await this.payments.findByOrder(orderId);
    if (!payment || payment.status !== 'PENDING') return;

    await this.close(payment.id, orderId);
  }

  /** The safety net: whatever the delayed jobs missed. Bounded per run — a sweeper
   *  that tries to fix everything at once fixes nothing and holds a connection open. */
  async sweep(): Promise<number> {
    const expired = await this.payments.findExpired();
    let closed = 0;

    for (const payment of expired) {
      if (await this.close(payment.id, payment.orderId)) closed += 1;
    }

    if (closed > 0) logger.info({ closed }, 'swept expired payments');
    return closed;
  }

  private async close(paymentId: string, orderId: string): Promise<boolean> {
    const toCancel = await this.payments.expire(paymentId, orderId);
    if (!toCancel) return false;

    // Goes through the normal transition, so the stock comes back through the same
    // path and ledger as any other cancellation (ADR-012). SYSTEM is the actor: the
    // buyer did not cancel this and neither did the shop.
    await this.orders.cancelAsSystem(toCancel, 'Quá hạn thanh toán');
    return true;
  }
}
