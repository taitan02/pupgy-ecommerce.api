import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ProductService } from '../services/product.service.js';
import { CategoryService } from '../services/category.service.js';
import { ShopService } from '../../shops/services/shop.service.js';
import { Public } from '../../../common/decorators/auth.decorators.js';

class SitemapEntryDto {
  @ApiProperty() url!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class SitemapDto {
  @ApiProperty({ type: [SitemapEntryDto] }) products!: SitemapEntryDto[];
  @ApiProperty({ type: [SitemapEntryDto] }) shops!: SitemapEntryDto[];
  @ApiProperty({ type: [SitemapEntryDto] }) categories!: SitemapEntryDto[];
}

/**
 * Everything the storefront's sitemap needs, in one call. Paths are built here
 * because the URL shape (/products/{slug}-{id}) is part of the contract between the two —
 * the storefront's routes and the canonical URLs must agree.
 */
@Public()
@ApiTags('storefront/sitemap')
@Controller('storefront/sitemap')
export class StorefrontSitemapController {
  constructor(
    private readonly products: ProductService,
    private readonly categories: CategoryService,
    private readonly shops: ShopService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Indexable URLs with their last change' })
  @ApiOkResponse({ type: SitemapDto })
  async get(): Promise<SitemapDto> {
    const [products, shops, categories] = await Promise.all([
      this.products.listForSitemap(),
      this.shops.listPublicForSitemap(),
      this.categories.getTree(),
    ]);

    const now = new Date().toISOString();

    return {
      products: products.map((product) => ({
        url: `/products/${product.slug}-${product.id}`,
        updatedAt: product.updatedAt.toISOString(),
      })),
      shops: shops.map((shop) => ({
        url: `/shops/${shop.slug}`,
        updatedAt: shop.updatedAt.toISOString(),
      })),
      // The tree is seeded data that changes rarely; there is no per-row timestamp
      // worth carrying, so today's date is honest enough for a sitemap hint.
      categories: categories.flatMap((parent) => [
        { url: `/categories/${parent.slug}`, updatedAt: now },
        ...parent.children.map((child) => ({ url: `/categories/${child.slug}`, updatedAt: now })),
      ]),
    };
  }
}
