import { Module } from '@nestjs/common';
import { StorefrontCategoryController } from './controllers/storefront-category.controller.js';
import { StorefrontProductController } from './controllers/storefront-product.controller.js';
import { SellerProductController } from './controllers/seller-product.controller.js';
import { SellerProductImageController } from './controllers/seller-product-image.controller.js';
import { StorefrontSitemapController } from './controllers/storefront-sitemap.controller.js';
import { CategoryService } from './services/category.service.js';
import { ProductService } from './services/product.service.js';
import { ProductImageService } from './services/product-image.service.js';
import { CategoryRepository } from './repositories/category.repository.js';
import { ProductRepository } from './repositories/product.repository.js';
import { ProductImageRepository } from './repositories/product-image.repository.js';
import { VariationRepository } from './repositories/variation.repository.js';
import { ShopsModule } from '../shops/shops.module.js';

@Module({
  imports: [ShopsModule], // ShopGuard needs ShopMemberRepository
  controllers: [
    StorefrontCategoryController,
    StorefrontProductController,
    SellerProductController,
    SellerProductImageController,
    StorefrontSitemapController,
  ],
  providers: [
    CategoryService,
    ProductService,
    ProductImageService,
    CategoryRepository,
    ProductRepository,
    ProductImageRepository,
    VariationRepository,
  ],
  // Other modules consume the services, never the repositories — that is what keeps
  // the monolith modular instead of just large.
  exports: [CategoryService, ProductService],
})
export class CatalogModule {}
