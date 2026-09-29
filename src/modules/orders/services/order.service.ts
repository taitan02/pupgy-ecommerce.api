import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';
import { toCursorPage, type CursorPageDto } from '../../../common/dto/cursor-page.dto.js';
import { StorageService } from '../../../infra/storage/storage.service.js';
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
      pending: counts.PENDING,
      confirmed: counts.CONFIRMED,
      shipping: counts.SHIPPING,
      delivered: counts.DELIVERED,
      cancelled: counts.CANCELLED,
    };
  }

  advanceAsSeller(id: string, to: OrderStatus, reason?: string): Promise<OrderDto> {
    return this.move({ load: () => this.requireForShop(id), to, actor: 'SELLER', reason });
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

    if (!canTransition(current.status, input.to, input.actor)) {
      throw AppError.conflict(`An order that is ${current.status} cannot become ${input.to}`, {
        status: current.status,
      });
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

    return toOrderDto(moved, this.storage, input.actor);
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
