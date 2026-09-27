import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductService } from '../services/product.service.js';
import { CreateProductDto, ProductStatusDto, UpdateProductDto, UpdateSkuDto } from '../dto/product.dto.js';
import { ProductDetailDto, ProductListItemDto } from '../dto/product-response.dto.js';
import { CursorQueryDto, type CursorPageDto } from '../../../common/dto/cursor-page.dto.js';
import { ShopGuard, SHOP_HEADER } from '../../../common/guards/shop.guard.js';
import { RequireAudience, RequireRoles } from '../../../common/decorators/auth.decorators.js';

/**
 * Seller view of the catalog: drafts, stock figures and archived products, none of
 * which the storefront may see. The shop comes from ShopGuard, so no route here takes
 * a shop id — there is nothing for a client to tamper with.
 */
@ApiTags('seller/products')
@ApiBearerAuth('access-token')
@ApiHeader({ name: SHOP_HEADER, required: true, description: 'Selected shop; re-authorised per request' })
@RequireAudience('SELLER')
@UseGuards(ShopGuard)
@Controller('seller/products')
export class SellerProductController {
  constructor(private readonly products: ProductService) {}

  @Post()
  @RequireRoles('OWNER', 'STAFF')
  @ApiOperation({ summary: 'Create a product with its options and SKUs' })
  @ApiOkResponse({ type: ProductDetailDto })
  create(@Body() dto: CreateProductDto): Promise<ProductDetailDto> {
    return this.products.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the shop products' })
  @ApiQuery({ name: 'status', enum: ProductStatusDto, required: false })
  listMine(
    @Query() query: CursorQueryDto,
    @Query('status') status?: ProductStatusDto,
  ): Promise<CursorPageDto<ProductListItemDto>> {
    return this.products.listForSeller({ cursor: query.cursor, limit: query.limit, status });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Product detail, including drafts' })
  @ApiOkResponse({ type: ProductDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductDetailDto> {
    return this.products.getForSeller(id);
  }

  @Patch(':id')
  @RequireRoles('OWNER', 'STAFF')
  @ApiOperation({ summary: 'Update product details or status' })
  @ApiOkResponse({ type: ProductDetailDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductDetailDto> {
    return this.products.update(id, dto);
  }

  @Patch(':id/skus/:skuId')
  @RequireRoles('OWNER', 'STAFF')
  @ApiOperation({ summary: 'Update one SKU price, stock or code' })
  @ApiOkResponse({ type: ProductDetailDto })
  updateSku(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() dto: UpdateSkuDto,
  ): Promise<ProductDetailDto> {
    return this.products.updateSku(id, skuId, dto);
  }
}
