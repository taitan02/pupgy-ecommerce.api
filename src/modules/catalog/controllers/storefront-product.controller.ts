import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductService } from '../services/product.service.js';
import {
  StorefrontProductDetailDto,
  StorefrontProductListItemDto,
} from '../dto/product-response.dto.js';
import { CursorQueryDto, type CursorPageDto } from '../../../common/dto/cursor-page.dto.js';
import { Public } from '../../../common/decorators/auth.decorators.js';

/**
 * Public catalog. Cross-shop by design — that is what makes this a marketplace — but
 * it only ever exposes ACTIVE products of ACTIVE shops, and never stock levels or
 * anything else the seller view carries.
 */
@Public()
@ApiTags('storefront/products')
@Controller('storefront/products')
export class StorefrontProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  @ApiOperation({ summary: 'Browse products across all shops' })
  @ApiQuery({ name: 'categorySlug', required: false, example: 'ao-nam' })
  @ApiQuery({ name: 'shopSlug', required: false, example: 'tai-store' })
  list(
    @Query() query: CursorQueryDto,
    @Query('categorySlug') categorySlug?: string,
    @Query('shopSlug') shopSlug?: string,
  ): Promise<CursorPageDto<StorefrontProductListItemDto>> {
    return this.products.listPublic({
      cursor: query.cursor,
      limit: query.limit,
      categorySlug,
      shopSlug,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Product detail for the product page' })
  @ApiOkResponse({ type: StorefrontProductDetailDto })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<StorefrontProductDetailDto> {
    return this.products.getPublic(id);
  }
}
