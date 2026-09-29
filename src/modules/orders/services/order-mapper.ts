import type { StorageService } from '../../../infra/storage/storage.service.js';
import type { OrderRow } from '../repositories/order.repository.js';
import { allowedTransitions, type Actor } from '../order-state.js';
import type { OrderDto, OrderItemDto, OrderListItemDto } from '../dto/order.dto.js';

/**
 * One mapper for both audiences. The difference between what a buyer and a seller see
 * is `allowedTransitions` — the buttons — not the data: both sides of a sale are
 * looking at the same record, and hiding the shop name from the seller or the buyer
 * name from the buyer would be theatre.
 */
export function toOrderDto(row: OrderRow, storage: StorageService, actor: Actor): OrderDto {
  // Object.assign rather than a spread: the DTOs are declared as classes so Swagger
  // can read them, and spreading a class-typed value is a real smell everywhere else.
  return Object.assign(toListItemDto(row, storage, actor), {
    items: row.items.map((item) => toItemDto(item, storage)),
    address: {
      recipientName: row.recipientName,
      phone: row.phone,
      formatted: [row.streetLine, row.wardName, row.provinceName].join(', '),
    },
    note: row.note,
    itemsSubtotal: row.itemsSubtotal,
    shippingFee: row.shippingFee,
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  });
}

export function toListItemDto(
  row: OrderRow,
  storage: StorageService,
  actor: Actor,
): OrderListItemDto {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    total: row.total,
    itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    firstItem: toItemDto(row.items[0]!, storage),
    shopId: row.shopId,
    shopName: row.shop.name,
    shopSlug: row.shop.slug,
    buyerName: row.buyer.fullName ?? row.buyer.email,
    placedAt: row.placedAt.toISOString(),
    allowedTransitions: allowedTransitions(row.status, actor),
  };
}

function toItemDto(item: OrderRow['items'][number], storage: StorageService): OrderItemDto {
  return {
    id: item.id,
    skuId: item.skuId,
    productId: item.productId,
    productName: item.productName,
    productSlug: item.productSlug,
    optionValues: item.optionValues,
    imageUrl: item.imageKey ? storage.publicUrl(item.imageKey) : null,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
  };
}
