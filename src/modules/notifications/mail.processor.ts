import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { MailService } from '../../infra/mail/mail.service.js';
import { logger } from '../../infra/logger/logger.js';
import { OrderService } from '../orders/services/order.service.js';
import { ShopService } from '../shops/services/shop.service.js';
import { UserRepository } from '../auth/repositories/user.repository.js';
import { MAIL_QUEUE, type MailJob } from './notification.types.js';
import {
  orderPlacedEmail,
  orderReceivedEmail,
  orderStatusEmail,
  type OrderEmailData,
} from './templates/order-emails.js';
import { passwordResetEmail } from './templates/password-reset-email.js';
import type { OrderRow } from '../orders/repositories/order.repository.js';
import type { Env } from '../../config/env.schema.js';
import type { OrderStatus } from '../../generated/prisma/enums.js';

/**
 * The consumer side. Runs only in the worker entrypoint.
 *
 * Every handler reads current state and renders here, at send time — not from the job
 * payload (ADR-013). A job that has been retried twice over three minutes still
 * describes what is true now.
 */
@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(
    private readonly mail: MailService,
    private readonly orders: OrderService,
    private readonly shops: ShopService,
    private readonly users: UserRepository,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job<MailJob>): Promise<void> {
    const data = job.data;

    switch (data.type) {
      case 'order-placed':
        return this.orderPlaced(data.orderId);
      case 'order-received':
        return this.orderReceived(data.orderId);
      case 'order-status':
        return this.orderStatus(data.orderId, data.status);
      case 'password-reset':
        return this.passwordReset(data.userId, data.token, data.audience);
    }
  }

  private async orderPlaced(orderId: string): Promise<void> {
    const order = await this.orders.findForNotification(orderId);
    if (!order) return this.gone(orderId);

    await this.mail.send(orderPlacedEmail(toEmailData(order), this.buyerOrderUrl(orderId)));
  }

  private async orderReceived(orderId: string): Promise<void> {
    const order = await this.orders.findForNotification(orderId);
    if (!order) return this.gone(orderId);

    const emails = await this.shops.listOwnerEmails(order.shopId);
    const data = toEmailData(order);
    // Sequentially rather than in parallel: a shop has a handful of owners, and a
    // relay is happier with one connection than with N at once.
    for (const email of emails) {
      await this.mail.send(orderReceivedEmail(data, email, this.sellerOrderUrl(orderId)));
    }
  }

  private async orderStatus(orderId: string, status: OrderStatus): Promise<void> {
    const order = await this.orders.findForNotification(orderId);
    if (!order) return this.gone(orderId);

    // The order may have moved on since the job was queued. Sending the email for the
    // state it is in now would be a lie of a different kind, so a stale job is dropped.
    if (order.status !== status) {
      logger.info({ orderId, queued: status, current: order.status }, 'skipping stale status email');
      return;
    }

    const message = orderStatusEmail(toEmailData(order), status, this.buyerOrderUrl(orderId));
    if (message) await this.mail.send(message);
  }

  private async passwordReset(
    userId: string,
    token: string,
    audience: 'STOREFRONT' | 'SELLER',
  ): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) return;

    const base = this.config.get(audience === 'SELLER' ? 'SELLER_URL' : 'STOREFRONT_URL', {
      infer: true,
    });

    await this.mail.send(
      passwordResetEmail({
        to: user.email,
        resetUrl: `${base}/reset-password?token=${encodeURIComponent(token)}`,
        ttlMinutes: this.config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true }),
      }),
    );
  }

  /** An order deleted before its email went out is not a failure to retry — there is
   *  nothing left to describe. */
  private gone(orderId: string): void {
    logger.warn({ orderId }, 'order disappeared before its email was sent');
  }

  private buyerOrderUrl(orderId: string): string {
    return `${this.config.get('STOREFRONT_URL', { infer: true })}/account/orders/${orderId}`;
  }

  private sellerOrderUrl(orderId: string): string {
    return `${this.config.get('SELLER_URL', { infer: true })}/orders/${orderId}`;
  }
}

function toEmailData(order: OrderRow): OrderEmailData {
  return {
    code: order.code,
    shopName: order.shop.name,
    buyerEmail: order.buyer.email,
    buyerName: order.buyer.fullName ?? order.buyer.email,
    recipientName: order.recipientName,
    phone: order.phone,
    address: [order.streetLine, order.wardName, order.provinceName].join(', '),
    items: order.items.map((item) => ({
      productName: item.productName,
      optionValues: item.optionValues,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
    itemsSubtotal: order.itemsSubtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    cancelledBy: order.cancelledBy,
    cancelReason: order.cancelReason,
  };
}
