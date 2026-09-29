import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { CancelledBy, OrderStatus } from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { RequestContext } from '../../../common/context/request-context.js';

const ITEM_SELECT = {
  id: true,
  skuId: true,
  productId: true,
  productName: true,
  productSlug: true,
  optionValues: true,
  imageKey: true,
  unitPrice: true,
  quantity: true,
  lineTotal: true,
} as const;

const ORDER_SELECT = {
  id: true,
  code: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  itemsSubtotal: true,
  shippingFee: true,
  total: true,
  recipientName: true,
  phone: true,
  provinceName: true,
  wardName: true,
  streetLine: true,
  note: true,
  placedAt: true,
  confirmedAt: true,
  shippedAt: true,
  deliveredAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  shopId: true,
  buyerId: true,
  shop: { select: { name: true, slug: true } },
  buyer: { select: { fullName: true, email: true } },
  items: { orderBy: { id: 'asc' }, select: ITEM_SELECT },
} as const;

export type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

export interface NewOrderLine {
  id: string;
  skuId: string;
  productId: string;
  productName: string;
  productSlug: string;
  optionValues: string[];
  imageKey: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface NewOrder {
  id: string;
  code: string;
  shopId: string;
  buyerId: string;
  paymentMethod: 'COD';
  recipientName: string;
  phone: string;
  provinceName: string;
  wardName: string;
  streetLine: string;
  note: string | null;
  itemsSubtotal: number;
  shippingFee: number;
  total: number;
  idempotencyKey: string;
  lines: NewOrderLine[];
}

/** Thrown from inside the checkout transaction when the conditional stock update
 *  matched no row, i.e. somebody else took the units first. */
export class OutOfStockError extends Error {
  constructor(readonly skuId: string) {
    super(`SKU ${skuId} no longer has enough stock`);
  }
}

@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Places the order, takes the stock and empties the shop's cart lines — all or
   * nothing (ADR-012).
   *
   * Two details carry the weight:
   * - the decrement is `WHERE stock >= quantity`, so the check and the write are one
   *   statement and Postgres, not this process, decides who gets the last unit;
   * - lines are applied in SKU id order, so two buyers racing over the same two SKUs
   *   acquire the row locks in the same sequence and one waits instead of deadlocking.
   */
  async place(order: NewOrder): Promise<OrderRow> {
    const lines = [...order.lines].sort((a, b) => a.skuId.localeCompare(b.skuId));

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          id: order.id,
          code: order.code,
          shopId: order.shopId,
          buyerId: order.buyerId,
          paymentMethod: order.paymentMethod,
          recipientName: order.recipientName,
          phone: order.phone,
          provinceName: order.provinceName,
          wardName: order.wardName,
          streetLine: order.streetLine,
          note: order.note,
          itemsSubtotal: order.itemsSubtotal,
          shippingFee: order.shippingFee,
          total: order.total,
          idempotencyKey: order.idempotencyKey,
          items: {
            // No shopId here: the line reaches the order through the composite
            // (order_id, shop_id) relation, so Prisma fills it from the parent.
            create: lines.map((line) => ({
              id: line.id,
              skuId: line.skuId,
              productId: line.productId,
              productName: line.productName,
              productSlug: line.productSlug,
              optionValues: line.optionValues,
              imageKey: line.imageKey,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              lineTotal: line.lineTotal,
            })),
          },
        },
        select: ORDER_SELECT,
      });

      for (const line of lines) {
        const stockAfter = await takeStock(tx, line.skuId, line.quantity);
        await tx.inventoryMovement.create({
          data: {
            id: uuidv7(),
            shopId: order.shopId,
            skuId: line.skuId,
            orderId: order.id,
            delta: -line.quantity,
            reason: 'ORDER_PLACED',
            stockAfter,
          },
        });
      }

      await tx.cartItem.deleteMany({
        where: { userId: order.buyerId, skuId: { in: lines.map((line) => line.skuId) } },
      });

      return created;
    });
  }

  /**
   * Moves the order, and gives the units back when the new state says to.
   *
   * The current status is part of the WHERE clause rather than something checked
   * beforehand: two sellers clicking "Xác nhận" at once would otherwise both pass the
   * check, and the second would restock or re-stamp an order that had already moved.
   */
  async transition(input: {
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
    restock: boolean;
    cancelledBy?: CancelledBy;
    cancelReason?: string | null;
  }): Promise<OrderRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const stamp: Record<string, Date> = {};
      if (input.to === 'CONFIRMED') stamp.confirmedAt = now;
      if (input.to === 'SHIPPING') stamp.shippedAt = now;
      if (input.to === 'DELIVERED') stamp.deliveredAt = now;
      if (input.to === 'CANCELLED') stamp.cancelledAt = now;

      const moved = await tx.order.updateMany({
        where: { id: input.orderId, status: input.from },
        data: {
          status: input.to,
          ...stamp,
          ...(input.to === 'CANCELLED'
            ? { cancelledBy: input.cancelledBy, cancelReason: input.cancelReason ?? null }
            : {}),
          // COD is collected by the courier, so delivery is also the moment it is paid.
          ...(input.to === 'DELIVERED' ? { paymentStatus: 'PAID' as const } : {}),
        },
      });
      if (moved.count === 0) return null;

      if (input.restock) {
        const items = await tx.orderItem.findMany({
          where: { orderId: input.orderId },
          orderBy: { skuId: 'asc' },
          select: { skuId: true, shopId: true, quantity: true },
        });

        for (const item of items) {
          const [row] = await tx.$queryRaw<{ stock: number }[]>`
            UPDATE skus SET stock = stock + ${item.quantity}, updated_at = now()
            WHERE id = ${item.skuId}::uuid
            RETURNING stock`;

          await tx.inventoryMovement.create({
            data: {
              id: uuidv7(),
              shopId: item.shopId,
              skuId: item.skuId,
              orderId: input.orderId,
              delta: item.quantity,
              reason: 'ORDER_CANCELLED',
              stockAfter: row?.stock ?? 0,
            },
          });
        }
      }

      return tx.order.findUnique({ where: { id: input.orderId }, select: ORDER_SELECT });
    });
  }

  findByIdempotencyKey(buyerId: string, idempotencyKey: string): Promise<OrderRow | null> {
    return this.prisma.order.findUnique({
      where: { buyerId_idempotencyKey: { buyerId, idempotencyKey } },
      select: ORDER_SELECT,
    });
  }

  // ---------- buyer (scoped to the buyer) ----------

  listForBuyer(buyerId: string, params: { cursor?: string; limit: number; status?: OrderStatus }) {
    return this.prisma.order.findMany({
      where: { buyerId, status: params.status },
      orderBy: { id: 'desc' },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: ORDER_SELECT,
    });
  }

  findForBuyer(buyerId: string, id: string): Promise<OrderRow | null> {
    return this.prisma.order.findFirst({ where: { id, buyerId }, select: ORDER_SELECT });
  }

  // ---------- seller (shop-scoped via RequestContext, ADR-006) ----------

  listForShop(params: { cursor?: string; limit: number; status?: OrderStatus }) {
    return this.prisma.order.findMany({
      where: { shopId: RequestContext.requireShopId(), status: params.status },
      orderBy: { id: 'desc' },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: ORDER_SELECT,
    });
  }

  findForShop(id: string): Promise<OrderRow | null> {
    return this.prisma.order.findFirst({
      where: { id, shopId: RequestContext.requireShopId() },
      select: ORDER_SELECT,
    });
  }

  async countByStatusForShop(): Promise<Record<OrderStatus, number>> {
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where: { shopId: RequestContext.requireShopId() },
      _count: { _all: true },
    });

    const counts = { PENDING: 0, CONFIRMED: 0, SHIPPING: 0, DELIVERED: 0, CANCELLED: 0 };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
  }

  /** Whether any of a product's SKUs has ever been sold. Answers the 409 on delete
   *  before the FK does it less helpfully. */
  async hasOrders(productId: string): Promise<boolean> {
    const found = await this.prisma.orderItem.findFirst({
      where: { productId, shopId: RequestContext.requireShopId() },
      select: { id: true },
    });
    return found !== null;
  }
}

/** One statement, so the decision and the write cannot be separated by another
 *  transaction. No rows back means the units are gone. */
async function takeStock(
  tx: Prisma.TransactionClient,
  skuId: string,
  quantity: number,
): Promise<number> {
  const rows = await tx.$queryRaw<{ stock: number }[]>`
    UPDATE skus SET stock = stock - ${quantity}, updated_at = now()
    WHERE id = ${skuId}::uuid AND stock >= ${quantity}
    RETURNING stock`;

  if (rows.length === 0) throw new OutOfStockError(skuId);
  return rows[0]!.stock;
}
