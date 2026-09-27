import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductService } from '../services/product.service.js';
import { CreateProductDto, UpdateProductDto, UpdateSkuDto } from '../dto/product.dto.js';
import { SellerProductQueryDto } from '../dto/product-query.dto.js';
import {
  ProductDetailDto,
  ProductListItemDto,
  ProductListPageDto,
  ProductSummaryDto,
} from '../dto/product-response.dto.js';
import { ReplaceVariationsDto, UpdateShippingDto } from '../dto/variation.dto.js';
import type { CursorPageDto } from '../../../common/dto/cursor-page.dto.js';
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
  @ApiOkResponse({ type: ProductListPageDto })
  listMine(@Query() query: SellerProductQueryDto): Promise<CursorPageDto<ProductListItemDto>> {
    return this.products.listForSeller({
      cursor: query.cursor,
      limit: query.limit,
      status: query.status,
      query: query.q,
      categoryId: query.categoryId,
      sort: query.sort,
    });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Product counts per status, for the list tabs' })
  @ApiOkResponse({ type: ProductSummaryDto })
  summary(): Promise<ProductSummaryDto> {
    return this.products.summary();
  }

  // Declared after /summary: a literal path must be registered before the :id
  // pattern, or "summary" is read as a product id.
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

  @Put(':id/variations')
  @RequireRoles('OWNER', 'STAFF')
  @ApiOperation({
    summary: 'Replace the option groups and the SKU grid',
    description:
      'Sent whole. A SKU whose option combination still exists keeps its id, so carts and orders stay attached to it.',
  })
  @ApiOkResponse({ type: ProductDetailDto })
  replaceVariations(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceVariationsDto,
  ): Promise<ProductDetailDto> {
    return this.products.replaceVariations(id, dto);
  }

  @Patch(':id/shipping')
  @RequireRoles('OWNER', 'STAFF')
  @ApiOperation({ summary: 'Update weight and dimensions' })
  @ApiOkResponse({ type: ProductDetailDto })
  updateShipping(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShippingDto,
  ): Promise<ProductDetailDto> {
    return this.products.updateShipping(id, dto);
  }

  @Delete(':id')
  @RequireRoles('OWNER')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a product permanently',
    description: 'Archiving (PATCH status=ARCHIVED) is the usual path for anything that has sold.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.products.delete(id);
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
