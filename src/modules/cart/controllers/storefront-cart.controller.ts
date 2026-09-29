import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CartService } from '../services/cart.service.js';
import { AddCartItemDto, CartCountDto, CartDto, UpdateCartItemDto } from '../dto/cart.dto.js';
import { CurrentUser, RequireAudience } from '../../../common/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/auth.types.js';

/**
 * There is no guest cart: a cart belongs to an account, so nothing is lost at login
 * and nothing has to be merged.
 *
 * Every mutation returns the whole cart. It is small, the client needs the recomputed
 * subtotals and stock warnings anyway, and a second round trip to fetch them is a
 * window in which the two disagree.
 */
@ApiTags('storefront/cart')
@ApiBearerAuth('access-token')
@RequireAudience('STOREFRONT')
@Controller('storefront/cart')
export class StorefrontCartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({ summary: 'The cart, grouped by shop' })
  @ApiOkResponse({ type: CartDto })
  get(@CurrentUser() user: AuthenticatedUser): Promise<CartDto> {
    return this.cart.get(user.id);
  }

  @Get('count')
  @ApiOperation({ summary: 'Line count for the header badge' })
  @ApiOkResponse({ type: CartCountDto })
  async count(@CurrentUser() user: AuthenticatedUser): Promise<CartCountDto> {
    return { itemCount: await this.cart.countLines(user.id) };
  }

  @Post('items')
  @ApiOperation({ summary: 'Add a SKU, or increase the quantity already in the cart' })
  @ApiOkResponse({ type: CartDto })
  @ApiConflictResponse({ description: 'Not enough stock; `availableStock` says how many there are' })
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddCartItemDto): Promise<CartDto> {
    return this.cart.add(user.id, dto.skuId, dto.quantity);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Set a line to an absolute quantity' })
  @ApiOkResponse({ type: CartDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartDto> {
    return this.cart.setQuantity(user.id, id, dto.quantity);
  }

  @Delete('items/:id')
  @ApiOperation({ summary: 'Remove a line' })
  @ApiOkResponse({ type: CartDto })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CartDto> {
    return this.cart.remove(user.id, id);
  }
}
