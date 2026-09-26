import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ShopService } from '../services/shop.service.js';
import {
  AddMemberDto,
  CreateShopDto,
  MyShopDto,
  ShopMemberDto,
  ShopResponseDto,
  UpdateShopDto,
} from '../dto/shop.dto.js';
import { ShopGuard, SHOP_HEADER } from '../../../common/guards/shop.guard.js';
import {
  CurrentShop,
  CurrentUser,
  RequireAudience,
  RequireRoles,
} from '../../../common/decorators/auth.decorators.js';
import type { AuthenticatedUser, AuthorisedShop } from '../../auth/auth.types.js';

/**
 * Seller audience only: a storefront token is rejected by the audience check even
 * though it belongs to the same person (ADR-007).
 */
@ApiTags('seller/shops')
@ApiBearerAuth('access-token')
@RequireAudience('SELLER')
@Controller('seller/shops')
export class SellerShopController {
  constructor(private readonly shops: ShopService) {}

  @Post()
  @ApiOperation({ summary: 'Create a shop; the caller becomes its owner' })
  @ApiOkResponse({ type: ShopResponseDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateShopDto): Promise<ShopResponseDto> {
    return this.shops.create(user.id, dto) as Promise<ShopResponseDto>;
  }

  @Get()
  @ApiOperation({ summary: 'Shops the caller belongs to (feeds the shop switcher)' })
  @ApiOkResponse({ type: [MyShopDto] })
  listMine(@CurrentUser() user: AuthenticatedUser): Promise<MyShopDto[]> {
    return this.shops.listMine(user.id);
  }

  // Everything below is scoped to the shop selected via X-Shop-Id and authorised by
  // ShopGuard. Note the URL carries no shop id: the client cannot address another
  // shop's data by editing a path.
  @Get('current')
  @UseGuards(ShopGuard)
  @ApiHeader({ name: SHOP_HEADER, required: true, description: 'Selected shop; re-authorised per request' })
  @ApiOperation({ summary: 'The currently selected shop' })
  @ApiOkResponse({ type: ShopResponseDto })
  current(@CurrentShop() shop: AuthorisedShop): Promise<ShopResponseDto> {
    return this.shops.getById(shop.id) as Promise<ShopResponseDto>;
  }

  @Patch('current')
  @UseGuards(ShopGuard)
  @RequireRoles('OWNER')
  @ApiHeader({ name: SHOP_HEADER, required: true })
  @ApiOperation({ summary: 'Update shop details (owner only)' })
  @ApiOkResponse({ type: ShopResponseDto })
  update(@CurrentShop() shop: AuthorisedShop, @Body() dto: UpdateShopDto): Promise<ShopResponseDto> {
    return this.shops.update(shop.id, dto) as Promise<ShopResponseDto>;
  }

  @Get('current/members')
  @UseGuards(ShopGuard)
  @ApiHeader({ name: SHOP_HEADER, required: true })
  @ApiOperation({ summary: 'List members of the selected shop' })
  @ApiOkResponse({ type: [ShopMemberDto] })
  async listMembers(@CurrentShop() shop: AuthorisedShop): Promise<ShopMemberDto[]> {
    const members = await this.shops.listMembers(shop.id);
    return members.map((member) => ({
      userId: member.user.id,
      email: member.user.email,
      fullName: member.user.fullName,
      role: member.role,
    }));
  }

  @Post('current/members')
  @UseGuards(ShopGuard)
  @RequireRoles('OWNER')
  @ApiHeader({ name: SHOP_HEADER, required: true })
  @ApiOperation({ summary: 'Add an existing platform user to the shop (owner only)' })
  addMember(@CurrentShop() shop: AuthorisedShop, @Body() dto: AddMemberDto) {
    return this.shops.addMember(shop.id, dto.email, dto.role);
  }

  @Delete('current/members/:userId')
  @UseGuards(ShopGuard)
  @RequireRoles('OWNER')
  @HttpCode(204)
  @ApiHeader({ name: SHOP_HEADER, required: true })
  @ApiOperation({ summary: 'Remove a member (owner only; the last owner cannot be removed)' })
  removeMember(
    @CurrentShop() shop: AuthorisedShop,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
  ): Promise<void> {
    return this.shops.removeMember(shop.id, userId, user.id);
  }
}
