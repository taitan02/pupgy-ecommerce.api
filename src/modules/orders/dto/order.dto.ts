import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CursorQueryDto } from '../../../common/dto/cursor-page.dto.js';
import { CartItemIssue } from '../../cart/dto/cart.dto.js';
import type {
  CancelledBy,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../generated/prisma/enums.js';

/** class-validator needs a runtime enum, and the generated file is not part of the
 *  contract layer. Same split as ProductStatusDto in the catalog. */
export enum OrderStatusDto {
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  SHIPPING = 'SHIPPING',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

const ORDER_STATUSES = Object.values(OrderStatusDto);

export class OrderItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) skuId!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty({ description: 'The name as it was when the order was placed' })
  productName!: string;
  @ApiProperty({ description: 'For the link back to the product page' })
  productSlug!: string;
  @ApiProperty({ example: ['Đen', 'L'] }) optionValues!: string[];
  @ApiProperty({ nullable: true, type: String }) imageUrl!: string | null;
  @ApiProperty({ example: 150_000 }) unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() lineTotal!: number;
}

export class OrderAddressDto {
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty({ description: 'Street, ward, province — ready to print on a label' })
  formatted!: string;
}

/** A row in either list. Enough to render a card without loading the lines. */
export class OrderListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'PG260929-K4M2XQ' }) code!: string;
  @ApiProperty({ enum: ORDER_STATUSES }) status!: OrderStatus;
  @ApiProperty({ enum: ['COD', 'SEPAY_QR'] }) paymentMethod!: PaymentMethod;
  @ApiProperty({ enum: ['UNPAID', 'PAID'] }) paymentStatus!: PaymentStatus;
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'Units across all lines' }) itemCount!: number;
  @ApiProperty({ type: OrderItemDto, description: 'For the thumbnail and "và N sản phẩm khác"' })
  firstItem!: OrderItemDto;
  @ApiProperty({ format: 'uuid' }) shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty() shopSlug!: string;
  @ApiProperty() buyerName!: string;
  @ApiProperty({ format: 'date-time' }) placedAt!: string;
  @ApiProperty({
    enum: ORDER_STATUSES,
    isArray: true,
    description: 'States the caller may move this order to right now. Drives the buttons.',
  })
  allowedTransitions!: OrderStatus[];
}

export class OrderDto extends OrderListItemDto {
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty({ type: OrderAddressDto }) address!: OrderAddressDto;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() itemsSubtotal!: number;
  @ApiProperty() shippingFee!: number;
  @ApiProperty({ enum: ['BUYER', 'SELLER', 'SYSTEM'], nullable: true })
  cancelledBy!: CancelledBy | null;
  @ApiProperty({ nullable: true, type: String }) cancelReason!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) confirmedAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) shippedAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) deliveredAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) cancelledAt!: string | null;
}

export class OrderListPageDto {
  @ApiProperty({ type: [OrderListItemDto] }) items!: OrderListItemDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

/** Tab counters for the order screens. */
export class OrderSummaryDto {
  @ApiProperty({ description: 'QR orders whose transfer has not arrived yet' })
  awaitingPayment!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() confirmed!: number;
  @ApiProperty() shipping!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty() cancelled!: number;
}

export class OrderQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: OrderStatusDto })
  @IsOptional()
  @IsEnum(OrderStatusDto)
  status?: OrderStatusDto;
}

/** A checkout line. Same shape as an order line plus the reasons it might not be
 *  payable, because the preview is where those get resolved. */
export class CheckoutLineDto extends OrderItemDto {
  @ApiProperty({ description: 'What the shop can ship right now' }) availableStock!: number;
  @ApiProperty({ enum: Object.values(CartItemIssue), nullable: true, type: String })
  issue!: CartItemIssue | null;
}

/**
 * What the buyer is about to agree to, priced from live catalog data rather than from
 * whatever the cart was showing.
 */
export class CheckoutQuoteDto {
  @ApiProperty({ format: 'uuid' }) shopId!: string;
  @ApiProperty() shopName!: string;
  @ApiProperty({ type: [CheckoutLineDto] }) items!: CheckoutLineDto[];
  @ApiProperty({ type: OrderAddressDto, nullable: true }) address!: OrderAddressDto | null;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) addressId!: string | null;
  @ApiProperty() itemsSubtotal!: number;
  @ApiProperty({ description: 'Flat per-order fee until shops have a pickup address (ADR-012)' })
  shippingFee!: number;
  @ApiProperty() total!: number;
  @ApiProperty({ enum: ['COD', 'SEPAY_QR'], isArray: true }) paymentMethods!: PaymentMethod[];
  @ApiProperty({ description: 'True when a line or the address needs fixing first' })
  blocked!: boolean;
}

/** Placing an order returns what is left of the cart too: checking out one shop of
 *  three leaves the client with a badge that is otherwise wrong until the next load. */
export class PlaceOrderResultDto {
  @ApiProperty({ type: OrderDto }) order!: OrderDto;
  @ApiProperty({ description: 'Lines still in the cart, across all shops' })
  remainingCartItems!: number;
}
