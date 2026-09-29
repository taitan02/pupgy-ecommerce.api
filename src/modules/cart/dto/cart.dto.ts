import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';

/** A line is a SKU, not a product: price and stock live on the SKU. */
export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ minimum: 1, maximum: 99, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number = 1;
}

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 1, maximum: 99 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity!: number;
}

/**
 * Why a line cannot be paid for. `null` is the normal case.
 *
 * - `INSUFFICIENT_STOCK`: the shop has fewer than the chosen quantity. The line keeps
 *   the quantity the shopper chose and the client offers to lower it — a cart that
 *   silently reduces quantities is a cart that charges for something nobody agreed to.
 * - `OUT_OF_STOCK`: nothing left at all.
 * - `UNAVAILABLE`: the listing is no longer on sale (draft, hidden, archived, the
 *   variation withdrawn, or the shop suspended).
 */
export enum CartItemIssue {
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  UNAVAILABLE = 'UNAVAILABLE',
}

export class CartItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) skuId!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() productSlug!: string;
  @ApiProperty({ type: [String], description: 'e.g. ["Đen", "L"]' }) optionValues!: string[];
  @ApiProperty({ description: 'Integer VND, read live — never what was shown when it was added' })
  unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() lineTotal!: number;
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;
  @ApiProperty({ description: 'What the shop can actually ship right now' }) availableStock!: number;
  @ApiProperty({ enum: CartItemIssue, nullable: true, type: String })
  issue!: CartItemIssue | null;
}

export class CartShopGroupDto {
  @ApiProperty({ format: 'uuid' }) shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty() shopSlug!: string;
  @ApiProperty({ type: [CartItemDto] }) items!: CartItemDto[];
  @ApiProperty({ description: 'Excludes lines that cannot be paid for' }) subtotal!: number;
  @ApiProperty({ description: 'Units counted in the subtotal' }) subtotalQuantity!: number;
  @ApiProperty({ description: 'A line needs fixing before this shop can be paid' })
  checkoutBlocked!: boolean;
}

/**
 * Grouped by shop, with no grand total and no global checkout, because no single
 * payment covers the cart: each shop is paid directly (ADR-001). A total across shops
 * would describe money that never moves as one amount.
 */
export class CartDto {
  @ApiProperty({ type: [CartShopGroupDto], description: 'Most recently added shop first' })
  groups!: CartShopGroupDto[];

  @ApiProperty({ description: 'Number of lines, across all shops — the header badge' })
  itemCount!: number;
}

export class CartCountDto {
  @ApiProperty() itemCount!: number;
}
