import { Module } from '@nestjs/common';
import { StorefrontCategoryController } from './controllers/storefront-category.controller.js';
import { CategoryService } from './services/category.service.js';
import { CategoryRepository } from './repositories/category.repository.js';

@Module({
  controllers: [StorefrontCategoryController],
  providers: [CategoryService, CategoryRepository],
  // Other modules consume the service, never the repository — that is what keeps
  // the monolith modular instead of just large.
  exports: [CategoryService],
})
export class CatalogModule {}
