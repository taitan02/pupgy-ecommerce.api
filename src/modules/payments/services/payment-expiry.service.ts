import { Injectable } from '@nestjs/common';
import { logger } from '../../../infra/logger/logger.js';
import { OrderService } from '../../orders/services/order.service.js';
import { PaymentService } from './payment.service.js';

/**
 * Closing the window on a payment nobody made.
 *
 * Both the per-payment delayed job and the periodic sweeper land here, so the decision
 * lives once. Safe to run twice: `markExpired` carries the current status in its WHERE
 * clause, so a transfer that arrived a moment ago wins and this does nothing.
 */
@Injectable()
export class PaymentExpiryService {
  constructor(
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
  ) {}

  async expirePayment(paymentId: string): Promise<void> {
    const orderIds = await this.payments.expire(paymentId);
    await this.cancelAll(orderIds);
  }

  /** The safety net: whatever the delayed jobs missed. Bounded per run. */
  async sweep(): Promise<number> {
    const expired = await this.payments.findExpired();
    let closed = 0;

    for (const payment of expired) {
      const orderIds = await this.payments.expire(payment.id);
      if (orderIds.length > 0) {
        await this.cancelAll(orderIds);
        closed += 1;
      }
    }

    if (closed > 0) logger.info({ closed }, 'swept expired payments');
    return closed;
  }

  /** One payment can cover several shops' orders, and all of them die together — the
   *  buyer paid for none of it. */
  private async cancelAll(orderIds: string[]): Promise<void> {
    for (const orderId of orderIds) {
      await this.orders.cancelAsSystem(orderId, 'Quá hạn thanh toán');
    }
  }
}
