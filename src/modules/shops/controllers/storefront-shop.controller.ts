import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { ShopService } from '../services/shop.service.js';
import { Public } from '../../../common/decorators/auth.decorators.js';

export class StorefrontShopDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
}

/** The shop as a shopper sees it: no membership, no bank details, no counts of drafts. */
@Public()
@ApiTags('storefront/shops')
@Controller('storefront/shops')
export class StorefrontShopController {
  constructor(private readonly shops: ShopService) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Public shop profile' })
  @ApiOkResponse({ type: StorefrontShopDto })
  get(@Param('slug') slug: string): Promise<StorefrontShopDto> {
    return this.shops.getPublicBySlug(slug);
  }
}
