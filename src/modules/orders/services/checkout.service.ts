import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AppError } from '../../../common/errors/app-error.js';
import { StorageService } from '../../../infra/storage/storage.service.js';
import { CartRepository, type CartLineRow } from '../../cart/repositories/cart.repository.js';
import { AddressRepository, type AddressRecord } from '../../addresses/repositories/address.repository.js';
import { CartItemIssue } from '../../cart/dto/cart.dto.js';
import { evaluateLine, optionValuesOf } from '../../cart/services/availability.js';
import { OrderRepository, OutOfStockError, type NewOrderLine } from '../repositories/order.repository.js';
import { generateOrderCode } from './order-code.js';
import { toOrderDto } from './order-mapper.js';
import type { CheckoutLineDto, CheckoutQuoteDto, PlaceOrderResultDto } from '../dto/order.dto.js';
import type { CheckoutPreviewDto, PlaceOrderDto } from '../dto/checkout.dto.js';

/**
 * One flat fee per order, not per parcel and not per province.
 *
 * Rates should key off the province pair (ADR-011), but a shop has no pickup address
 * yet, so the origin half of that lookup does not exist. A single visible constant is
 * a gap you can see; an invented rate table is a gap that looks like a feature.
 */
const SHIPPING_FLAT_FEE = 30_000;

@Injectable()
export class CheckoutService {
  constructor(
    private readonly cart: CartRepository,
    private readonly addresses: AddressRepository,
    private readonly orders: OrderRepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * Prices the shop's cart lines from live catalog data. Nothing here trusts what the
   * cart page was showing: between adding to the cart and reaching checkout a product
   * can be repriced, hidden or sold out, and the review step is the last honest place
   * to say so.
   */
  async preview(userId: string, dto: CheckoutPreviewDto): Promise<CheckoutQuoteDto> {
    const rows = await this.cart.listForShop(userId, dto.shopId);
    if (rows.length === 0) throw AppError.notFound('Nothing from this shop in your cart');

    const address = await this.resolveAddress(userId, dto.addressId);
    const items = rows.map((row) => this.toCheckoutLine(row));
    const itemsSubtotal = items.reduce(
      (sum, item) => (item.issue ? sum : sum + item.lineTotal),
      0,
    );

    return {
      shopId: dto.shopId,
      shopName: rows[0]!.sku.product.shop.name,
      items,
      addressId: address?.id ?? null,
      address: address
        ? {
            recipientName: address.recipientName,
            phone: address.phone,
            formatted: [address.streetLine, address.wardName, address.provinceName].join(', '),
          }
        : null,
      itemsSubtotal,
      shippingFee: SHIPPING_FLAT_FEE,
      total: itemsSubtotal + SHIPPING_FLAT_FEE,
      paymentMethods: ['COD'],
      blocked: !address || items.some((item) => item.issue !== null),
    };
  }

  async place(userId: string, dto: PlaceOrderDto): Promise<PlaceOrderResultDto> {
    const replayed = await this.orders.findByIdempotencyKey(userId, dto.idempotencyKey);
    if (replayed) {
      // A resubmitted form, a retried request, a double tap. Returning the first order
      // is the whole point of the key: the alternative is charging twice for the same
      // basket and letting a human sort it out (ADR-012).
      return this.result(replayed, userId);
    }

    const rows = await this.cart.listForShop(userId, dto.shopId);
    if (rows.length === 0) throw AppError.notFound('Nothing from this shop in your cart');

    const address = await this.addresses.findOwned(userId, dto.addressId);
    if (!address) throw AppError.notFound('Address not found');

    const items = rows.map((row) => this.toCheckoutLine(row));
    const unusable = items.filter((item) => item.issue !== null);
    if (unusable.length > 0) {
      throw AppError.conflict('Some items can no longer be ordered', {
        items: unusable.map((item) => ({
          skuId: item.skuId,
          productName: item.productName,
      productSlug: item.productSlug,
          issue: item.issue,
          availableStock: item.availableStock,
        })),
      });
    }

    const itemsSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const lines: NewOrderLine[] = items.map((item) => ({
      id: uuidv7(),
      skuId: item.skuId,
      productId: item.productId,
      productName: item.productName,
      productSlug: item.productSlug,
      optionValues: item.optionValues,
      // The key, not the URL: the public URL is built from it, so moving bucket or
      // domain does not rewrite every order ever placed.
      imageKey: rows.find((row) => row.skuId === item.skuId)!.sku.product.images[0]?.storageKey ?? null,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    }));

    try {
      const order = await this.orders.place({
        id: uuidv7(),
        code: generateOrderCode(),
        shopId: dto.shopId,
        buyerId: userId,
        paymentMethod: 'COD',
        recipientName: address.recipientName,
        phone: address.phone,
        provinceName: address.provinceName,
        wardName: address.wardName,
        streetLine: address.streetLine,
        note: dto.note?.trim() || null,
        itemsSubtotal,
        shippingFee: SHIPPING_FLAT_FEE,
        total: itemsSubtotal + SHIPPING_FLAT_FEE,
        idempotencyKey: dto.idempotencyKey,
        lines,
      });

      return this.result(order, userId);
    } catch (error) {
      if (error instanceof OutOfStockError) {
        const line = items.find((item) => item.skuId === error.skuId);
        // Lost the race inside the transaction: somebody else took the units between
        // the check above and the decrement. Nothing was written.
        throw AppError.conflict('Someone just bought the last of one of these items', {
          items: [{ skuId: error.skuId, productName: line?.productName, issue: CartItemIssue.OUT_OF_STOCK }],
        });
      }

      // Two concurrent submits of the same key: one wins the unique index, the other
      // reads back what the winner wrote.
      const concurrent = await this.orders.findByIdempotencyKey(userId, dto.idempotencyKey);
      if (concurrent) return this.result(concurrent, userId);
      throw error;
    }
  }

  private async result(
    order: Awaited<ReturnType<OrderRepository['place']>>,
    userId: string,
  ): Promise<PlaceOrderResultDto> {
    return {
      order: toOrderDto(order, this.storage, 'BUYER'),
      remainingCartItems: await this.cart.countLines(userId),
    };
  }

  private async resolveAddress(userId: string, addressId?: string): Promise<AddressRecord | null> {
    if (addressId) return this.addresses.findOwned(userId, addressId);
    const all = await this.addresses.list(userId);
    // The list is ordered default-first, so the first row is the pre-selection.
    return all[0] ?? null;
  }

  private toCheckoutLine(row: CartLineRow): CheckoutLineDto {
    const { sku } = row;
    const product = sku.product;
    const { issue, availableStock } = evaluateLine(row);

    return {
      id: row.id,
      skuId: row.skuId,
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      optionValues: optionValuesOf(row),
      imageUrl: product.images[0] ? this.storage.publicUrl(product.images[0].storageKey) : null,
      unitPrice: sku.price,
      quantity: row.quantity,
      lineTotal: sku.price * row.quantity,
      availableStock,
      issue,
    };
  }
}
