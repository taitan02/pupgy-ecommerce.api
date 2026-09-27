import { ApiProperty } from '@nestjs/swagger';

export class SkuResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, type: String }) code!: string | null;
  @ApiProperty({ example: 150_000, description: 'Integer VND' }) price!: number;
  @ApiProperty({ example: 10 }) stock!: number;
  @ApiProperty({ example: ['Đen', 'M'], description: 'Option values, in option order' })
  optionValues!: string[];
}

export class ProductOptionResponseDto {
  @ApiProperty({ example: 'Màu sắc' }) name!: string;
  @ApiProperty({ example: ['Đen', 'Trắng'] }) values!: string[];
}

export class ProductDetailDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ format: 'uuid' }) categoryId!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'HIDDEN', 'ARCHIVED'] }) status!: string;
  @ApiProperty({ type: [ProductOptionResponseDto] }) options!: ProductOptionResponseDto[];
  @ApiProperty({ type: [SkuResponseDto] }) skus!: SkuResponseDto[];
}

/**
 * List view. Deliberately not the detail shape: a listing needs a price range and a
 * total stock figure, not every SKU, and sending the full tree for 20 products would
 * be a large payload for data the page does not render.
 */
export class ProductListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'HIDDEN', 'ARCHIVED'] }) status!: string;
  @ApiProperty({ example: 150_000 }) priceFrom!: number;
  @ApiProperty({ example: 220_000 }) priceTo!: number;
  @ApiProperty({ example: 42, description: 'Sum of stock across SKUs' }) totalStock!: number;
}

export class StorefrontProductListItemDto extends ProductListItemDto {
  @ApiProperty({ example: 'Tai Store' }) shopName!: string;
  @ApiProperty({ example: 'tai-store' }) shopSlug!: string;
}

export class StorefrontProductDetailDto extends ProductDetailDto {
  @ApiProperty({ example: 'Tai Store' }) shopName!: string;
  @ApiProperty({ example: 'tai-store' }) shopSlug!: string;
}
