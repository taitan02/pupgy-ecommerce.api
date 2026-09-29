import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { CartRepository, type CartLineRow } from '../repositories/cart.repository.js';
import { StorageService } from '../../../infra/storage/storage.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { CartItemIssue, type CartDto, type CartItemDto, type CartShopGroupDto } from '../dto/cart.dto.js';
import { evaluateLine, optionValuesOf } from './availability.js';

/** A cart with more lines than this is a mistake or a script, not a shopper. */
const MAX_LINES = 50;
const MAX_QUANTITY_PER_LINE = 99;

@Injectable()
export class CartService {
  constructor(
    private readonly cart: CartRepository,
    private readonly storage: StorageService,
  ) {}

  async get(userId: string): Promise<CartDto> {
    const rows = await this.cart.list(userId);
    return { groups: groupByShop(rows.map((row) => this.toItem(row))), itemCount: rows.length };
  }

  countLines(userId: string): Promise<number> {
    return this.cart.countLines(userId);
  }

  /**
   * Adding a SKU that is already in the cart increases its quantity rather than
   * creating a second line — the shopper thinks in products, not in rows.
   */
  async add(userId: string, skuId: string, quantity: number): Promise<CartDto> {
    const sku = await this.cart.findSku(skuId);
    if (!sku) throw AppError.notFound('Product not found');

    if (!sku.isSellable || sku.product.status !== 'ACTIVE' || sku.product.shop.status !== 'ACTIVE') {
      // 404, not 403: as far as a shopper is concerned a listing that is not on sale
      // does not exist, and saying "hidden" would leak the seller's draft workflow.
      throw AppError.notFound('This product is not on sale');
    }

    const existing = await this.cart.findBySku(userId, skuId);
    if (!existing && (await this.cart.countLines(userId)) >= MAX_LINES) {
      throw AppError.conflict(`A cart holds at most ${MAX_LINES} products`);
    }

    const wanted = Math.min((existing?.quantity ?? 0) + quantity, MAX_QUANTITY_PER_LINE);
    if (wanted > sku.stock) {
      throw AppError.conflict('Not enough stock for that quantity', { availableStock: sku.stock });
    }

    await this.cart.upsertQuantity({
      id: uuidv7(),
      userId,
      shopId: sku.shopId,
      skuId,
      quantity: wanted,
    });

    return this.get(userId);
  }

  /**
   * Sets an absolute quantity. Unlike adding, this accepts a quantity above the
   * current stock: it is how the client answers its own "Đổi thành 2" prompt, and
   * refusing here would make a line unfixable when stock moves mid-edit.
   */
  async setQuantity(userId: string, itemId: string, quantity: number): Promise<CartDto> {
    const line = await this.cart.findOwned(userId, itemId);
    if (!line) throw AppError.notFound('Cart item not found');

    await this.cart.setQuantity(itemId, quantity);
    return this.get(userId);
  }

  async remove(userId: string, itemId: string): Promise<CartDto> {
    if (!(await this.cart.remove(userId, itemId))) {
      throw AppError.notFound('Cart item not found');
    }
    return this.get(userId);
  }

  private toItem(row: CartLineRow): CartItemDto & { shop: CartLineRow['sku']['product']['shop'] } {
    const { sku } = row;
    const product = sku.product;
    const { issue, availableStock } = evaluateLine(row);
    const cover = product.images[0];

    return {
      id: row.id,
      skuId: row.skuId,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      optionValues: optionValuesOf(row),
      // Read from the SKU on every request. A cart that remembers the price it was
      // added at is a cart that quotes a price the shop is not offering.
      unitPrice: sku.price,
      quantity: row.quantity,
      lineTotal: sku.price * row.quantity,
      imageUrl: cover ? this.storage.publicUrl(cover.storageKey) : null,
      availableStock,
      issue,
      shop: product.shop,
    };
  }
}

/**
 * Shops keep the order of the rows, which arrive newest first: the shop just added to
 * is the one the shopper is looking for.
 */
function groupByShop(
  items: (CartItemDto & { shop: { id: string; name: string; slug: string } })[],
): CartShopGroupDto[] {
  const groups = new Map<string, CartShopGroupDto>();

  for (const { shop, ...item } of items) {
    let group = groups.get(shop.id);
    if (!group) {
      group = {
        shopId: shop.id,
        shopName: shop.name,
        shopSlug: shop.slug,
        items: [],
        subtotal: 0,
        subtotalQuantity: 0,
        checkoutBlocked: false,
      };
      groups.set(shop.id, group);
    }

    group.items.push(item);

    // A line the shop cannot ship is shown but not charged for; a line whose quantity
    // is merely too high still counts, because that is the amount on screen and the
    // shopper is the one who decides to lower it.
    if (item.issue !== CartItemIssue.UNAVAILABLE && item.issue !== CartItemIssue.OUT_OF_STOCK) {
      group.subtotal += item.lineTotal;
      group.subtotalQuantity += item.quantity;
    }
    if (item.issue === CartItemIssue.INSUFFICIENT_STOCK || item.issue === CartItemIssue.OUT_OF_STOCK) {
      group.checkoutBlocked = true;
    }
  }

  return [...groups.values()];
}
