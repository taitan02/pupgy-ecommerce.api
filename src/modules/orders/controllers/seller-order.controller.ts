import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OrderService } from '../services/order.service.js';
import { CancelOrderDto } from '../dto/checkout.dto.js';
import { OrderDto, OrderListPageDto, OrderQueryDto, OrderSummaryDto } from '../dto/order.dto.js';
import { SHOP_HEADER, ShopGuard } from '../../../common/guards/shop.guard.js';
import { RequireAudience, RequireRoles } from '../../../common/decorators/auth.decorators.js';

/**
 * The shop's side of the sale. Each action is its own endpoint rather than a PATCH of
 * `status`: "xác nhận" and "đã giao" are different decisions with different
 * consequences, and a client that can PUT any status is a client that can invent one.
 */
@ApiTags('seller/orders')
@ApiBearerAuth('access-token')
@ApiHeader({ name: SHOP_HEADER, required: true, description: 'Selected shop; re-authorised per request' })
@RequireAudience('SELLER')
@UseGuards(ShopGuard)
@Controller('seller/orders')
export class SellerOrderController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  @ApiOperation({ summary: 'The shop’s orders, newest first' })
  @ApiOkResponse({ type: OrderListPageDto })
  list(@Query() query: OrderQueryDto) {
    return this.orders.listForShop(query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Counts per status, for the tabs' })
  @ApiOkResponse({ type: OrderSummaryDto })
  summary(): Promise<OrderSummaryDto> {
    return this.orders.summaryForShop();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One order' })
  @ApiOkResponse({ type: OrderDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.orders.getForShop(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequireRoles('OWNER', 'STAFF')
  @ApiOperation({ summary: 'Accept the order and start preparing it' })
  @ApiOkResponse({ type: OrderDto })
  @ApiConflictResponse({ description: 'The order is no longer pending' })
  confirm(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.orders.advanceAsSeller(id, 'CONFIRMED');
  }

  @Post(':id/ship')
  @HttpCode(200)
  @RequireRoles('OWNER', 'STAFF')
  @ApiOperation({ summary: 'Hand the parcel to the courier' })
  @ApiOkResponse({ type: OrderDto })
  ship(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.orders.advanceAsSeller(id, 'SHIPPING');
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @RequireRoles('OWNER', 'STAFF')
  @ApiOperation({ summary: 'Mark delivered; COD is collected at this point' })
  @ApiOkResponse({ type: OrderDto })
  deliver(@Param('id', ParseUUIDPipe) id: string): Promise<OrderDto> {
    return this.orders.advanceAsSeller(id, 'DELIVERED');
  }

  @Post(':id/cancel')
  @HttpCode(200)
  // Refusing a sale is the owner's call: it is the one action here a buyer will
  // complain about, and staff turnover should not carry that authority by default.
  @RequireRoles('OWNER')
  @ApiOperation({ summary: 'Refuse the order and give the stock back' })
  @ApiOkResponse({ type: OrderDto })
  @ApiConflictResponse({ description: 'Already shipped — cancelling is a return, not a cancel' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto): Promise<OrderDto> {
    return this.orders.advanceAsSeller(id, 'CANCELLED', dto.reason);
  }
}
