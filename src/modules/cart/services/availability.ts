import { CartItemIssue } from '../dto/cart.dto.js';
import type { CartLineRow } from '../repositories/cart.repository.js';

/**
 * Whether a line can be paid for, in one place.
 *
 * The cart and the checkout review must agree exactly: a cart that shows a line as
 * fine and a checkout that refuses it — or the reverse — is how a shopper ends up
 * clicking "Đặt hàng" on something the API will reject.
 */
export function evaluateLine(row: CartLineRow): {
  issue: CartItemIssue | null;
  availableStock: number;
} {
  const { sku } = row;
  const product = sku.product;
  const unavailable =
    !sku.isSellable || product.status !== 'ACTIVE' || product.shop.status !== 'ACTIVE';

  if (unavailable) return { issue: CartItemIssue.UNAVAILABLE, availableStock: 0 };
  if (sku.stock === 0) return { issue: CartItemIssue.OUT_OF_STOCK, availableStock: 0 };
  if (row.quantity > sku.stock) {
    return { issue: CartItemIssue.INSUFFICIENT_STOCK, availableStock: sku.stock };
  }
  return { issue: null, availableStock: sku.stock };
}

/** The option values a line was chosen with, in option order. */
export function optionValuesOf(row: CartLineRow): string[] {
  return [row.sku.optionValue1?.value, row.sku.optionValue2?.value].filter(
    (value): value is string => Boolean(value),
  );
}
