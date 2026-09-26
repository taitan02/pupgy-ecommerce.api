import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoryService } from '../services/category.service.js';
import { CategoryResponseDto } from '../dto/category-response.dto.js';
import { Public } from '../../../common/decorators/auth.decorators.js';

/**
 * Storefront audience: public, unauthenticated, cacheable. The seller-facing
 * controllers live in separate files with their own guards — one controller serving
 * both audiences is how data leaks past an `if (isSeller)` branch.
 */
@Public()
@ApiTags('storefront/categories')
@Controller('storefront/categories')
export class StorefrontCategoryController {
  constructor(private readonly categories: CategoryService) {}

  @Get()
  @ApiOperation({ summary: 'Get the platform category tree' })
  @ApiOkResponse({ type: [CategoryResponseDto] })
  getTree(): Promise<CategoryResponseDto[]> {
    return this.categories.getTree();
  }
}
