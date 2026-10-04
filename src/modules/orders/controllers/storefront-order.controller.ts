import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckoutService } from '../services/checkout.service.js';
import { OrderService } from '../services/order.service.js';
import { CancelOrderDto, CheckoutPreviewDto, PlaceOrderDto } from '../dto/checkout.dto.js';
import {
  CheckoutQuoteDto,
  OrderDto,
  OrderListPageDto,
  OrderQueryDto,
  PlaceOrderResultDto,
} from '../dto/order.dto.js';
import { PaymentInstructionsDto } from '../../payments/dto/payment.dto.js';
import { CurrentUser, RequireAudience } from '../../../common/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/auth.types.js';

/**
 * Checkout is per shop (ADR-012). A cart with three shops is three calls to
 * `POST /orders`, each with its own idempotency key and its own result.
 */
@ApiTags('storefront/orders')
@ApiBearerAuth('access-token')
@RequireAudience('STOREFRONT')
@Controller('storefront')
export class StorefrontOrderController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly orders: OrderService,
  ) {}

  @Post('checkout/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Price one shop’s cart lines, live, before ordering' })
  @ApiOkResponse({ type: CheckoutQuoteDto })
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CheckoutPreviewDto,
  ): Promise<CheckoutQuoteDto> {
    return this.checkout.preview(user.id, dto);
  }

  @Post('orders')
  @ApiOperation({ summary: 'Place the order for one shop and take its stock' })
  @ApiCreatedResponse({ type: PlaceOrderResultDto })
  @ApiConflictResponse({
    description: 'A line sold out or went off sale; `items` says which and why',
  })
  place(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PlaceOrderDto,
  ): Promise<PlaceOrderResultDto> {
    return this.checkout.place(user.id, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: 'The buyer’s own orders, newest first' })
  @ApiOkResponse({ type: OrderListPageDto })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: OrderQueryDto) {
    return this.orders.listForBuyer(user.id, query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'One order' })
  @ApiOkResponse({ type: OrderDto })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDto> {
    return this.orders.getForBuyer(user.id, id);
  }

  @Get('orders/:id/payment')
  @ApiOperation({ summary: 'QR, bank details and the memo to use for a transfer order' })
  @ApiOkResponse({ type: PaymentInstructionsDto })
  payment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentInstructionsDto> {
    return this.orders.paymentFor(user.id, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel, while the shop has not confirmed yet' })
  @ApiOkResponse({ type: OrderDto })
  @ApiConflictResponse({ description: 'Too late — the shop has already confirmed' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderDto> {
    return this.orders.cancelAsBuyer(user.id, id, dto.reason);
  }
}
