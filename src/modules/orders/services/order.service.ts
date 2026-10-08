import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import { toCursorPage, type CursorPageDto } from '../../../common/dto/cursor-page.dto.js';
import { logger } from '../../../infra/logger/logger.js';
import { StorageService } from '../../../infra/storage/storage.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { PaymentService } from '../../payments/services/payment.service.js';
import { ReleaseService } from '../../payments/services/release.service.js';
import { OrderRepository, type OrderRow } from '../repositories/order.repository.js';
import { canTransition, RESTOCKS_ON_CANCEL, type Actor } from '../order-state.js';
import { toListItemDto, toOrderDto } from './order-mapper.js';
import type { OrderDto, OrderListItemDto, OrderQueryDto, OrderSummaryDto } from '../dto/order.dto.js';
import type { OrderStatus } from '../../../generated/prisma/enums.js';

@Injectable()
export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
    private readonly payments: PaymentService,
    private readonly release: ReleaseService,
  ) {}

  // ---------- buyer ----------

  async listForBuyer(buyerId: string, query: OrderQueryDto): Promise<CursorPageDto<OrderListItemDto>> {
    const rows = await this.orders.listForBuyer(buyerId, {
      cursor: query.cursor,
      limit: query.limit,
      status: query.status,
    });
    return toCursorPage(rows.map((row) => toListItemDto(row, this.storage, 'BUYER')), query.limit);
  }

  async getForBuyer(buyerId: string, id: string): Promise<OrderDto> {
    return toOrderDto(await this.requireForBuyer(buyerId, id), this.storage, 'BUYER');
  }

  /** What the buyer needs in order to transfer. Scoped to them: a payment reference
   *  is enough to pay somebody else's order by accident. */
  async paymentFor(buyerId: string, orderId: string) {
    await this.requireForBuyer(buyerId, orderId);
    const payment = await this.payments.findForOrder(orderId);
    if (!payment) throw AppError.notFound('This order is not paid by transfer');

    return this.payments.instructionsFor(payment);
  }

  /**
   * The buyer accepting the goods. This — not the courier's DELIVERED — is what
   * releases the shop's money, so it goes through ReleaseService rather than the
   * ordinary transition: completing the order and crediting the shop have to commit
   * together (ADR-015).
   */
  async completeAsBuyer(buyerId: string, id: string): Promise<OrderDto> {
    const order = await this.requireForBuyer(buyerId, id);

    // Already done is not an error. A double tap, or the auto-release job having got
    // there first, should look like success to the person pressing the button — the
    // property that matters is that the shop is not paid twice, and the release
    // transaction guarantees that on its own.
    if (order.status === 'COMPLETED') return toOrderDto(order, this.storage, 'BUYER');

    if (!canTransition(order.status, 'COMPLETED', 'BUYER')) {
      throw AppError.conflict('Only a delivered order can be confirmed');
    }

    if (!(await this.release.complete(id))) {
      // The auto-release job reached it first. Nothing is wrong and nothing is owed
      // twice; the buyer just sees the order already completed.
      logger.info({ orderId: id }, 'order was already completed when the buyer confirmed');
    }

    return this.getForBuyer(buyerId, id);
  }

  /** The buyer changing their mind, which is only allowed while the shop has not
   *  started packing (ADR-012). */
  cancelAsBuyer(buyerId: string, id: string, reason?: string): Promise<OrderDto> {
    return this.move({
      load: () => this.requireForBuyer(buyerId, id),
      to: 'CANCELLED',
      actor: 'BUYER',
      reason,
    });
  }

  /**
   * The expiry job closing an unpaid order. Not reachable from any endpoint: `SYSTEM`
   * is the only actor allowed to make this move, and it loads the order unscoped
   * because there is no caller to scope it to (ADR-014).
   */
  cancelAsSystem(orderId: string, reason: string): Promise<OrderDto> {
    return this.move({
      load: () => this.requireForNotification(orderId),
      to: 'CANCELLED',
      actor: 'SYSTEM',
      reason,
    });
  }

  // ---------- seller (shop comes from RequestContext) ----------

  async listForShop(query: OrderQueryDto): Promise<CursorPageDto<OrderListItemDto>> {
    const rows = await this.orders.listForShop({
      cursor: query.cursor,
      limit: query.limit,
      status: query.status,
    });
    return toCursorPage(rows.map((row) => toListItemDto(row, this.storage, 'SELLER')), query.limit);
  }

  async getForShop(id: string): Promise<OrderDto> {
    return toOrderDto(await this.requireForShop(id), this.storage, 'SELLER');
  }

  async summaryForShop(): Promise<OrderSummaryDto> {
    const counts = await this.orders.countByStatusForShop();
    return {
      awaitingPayment: counts.AWAITING_PAYMENT,
      pending: counts.PENDING,
      confirmed: counts.CONFIRMED,
      shipping: counts.SHIPPING,
      delivered: counts.DELIVERED,
      completed: counts.COMPLETED,
      cancelled: counts.CANCELLED,
    };
  }

  advanceAsSeller(id: string, to: OrderStatus, reason?: string): Promise<OrderDto> {
    return this.move({ load: () => this.requireForShop(id), to, actor: 'SELLER', reason });
  }

  /** The order behind a queued email, with no caller to scope it to. See the
   *  repository method for why this exception exists. */
  findForNotification(orderId: string): Promise<OrderRow | null> {
    return this.orders.findForNotification(orderId);
  }

  /** Whether any of a product's SKUs has ever been sold, for the catalog's delete
   *  guard. The FK would refuse the delete anyway; this turns it into an answer the
   *  seller can act on. */
  hasOrdersForProduct(productId: string): Promise<boolean> {
    return this.orders.hasOrders(productId);
  }

  // ---------- shared ----------

  /**
   * Every state change goes through here, so the rule about who may do what lives in
   * exactly one place and the restock decision cannot be forgotten on a new path.
   */
  private async move(input: {
    load: () => Promise<OrderRow>;
    to: OrderStatus;
    actor: Actor;
    reason?: string;
  }): Promise<OrderDto> {
    const current = await input.load();

    if (!canTransition(current.status, input.to, input.actor, current.paymentStatus === 'PAID')) {
      throw AppError.conflict(
        current.paymentStatus === 'PAID' && input.actor === 'BUYER' && input.to === 'CANCELLED'
          ? 'This order is already paid — ask the shop to cancel and refund it'
          : `An order that is ${current.status} cannot become ${input.to}`,
        { status: current.status },
      );
    }

    const moved = await this.orders.transition({
      orderId: current.id,
      from: current.status,
      to: input.to,
      restock: input.to === 'CANCELLED' && RESTOCKS_ON_CANCEL.includes(current.status),
      cancelledBy: input.to === 'CANCELLED' ? input.actor : undefined,
      cancelReason: input.reason?.trim() || null,
    });

    if (!moved) {
      // The status changed under us between the read and the write — the other side
      // of the sale got there first.
      throw AppError.conflict('This order has just been updated; reload and try again');
    }

    // A cancelled order has no open payment window. Doing this here rather than in
    // each caller means the buyer giving up, the shop refusing and the expiry job all
    // close it the same way.
    if (input.to === 'CANCELLED') {
      await this.payments.cancelForOrder(moved.id);
      // Money that was taken has to go back. Does nothing for an unpaid order, and
      // knows the difference between reversing a hold and reversing a credit.
      await this.release.refund(moved.id);
    }

    // The transition transaction has committed by now, and the job carries only the
    // id and the state it was queued for — the worker drops it if the order has moved
    // on since (ADR-013).
    await this.notifications.enqueue({ type: 'order-status', orderId: moved.id, status: input.to });

    return toOrderDto(moved, this.storage, input.actor);
  }

  private async requireForNotification(id: string): Promise<OrderRow> {
    const order = await this.orders.findForNotification(id);
    if (!order) throw AppError.notFound('Order not found');
    return order;
  }

  private async requireForBuyer(buyerId: string, id: string): Promise<OrderRow> {
    const order = await this.orders.findForBuyer(buyerId, id);
    if (!order) throw AppError.notFound('Order not found');
    return order;
  }

  private async requireForShop(id: string): Promise<OrderRow> {
    const order = await this.orders.findForShop(id);
    if (!order) throw AppError.notFound('Order not found');
    return order;
  }
}
