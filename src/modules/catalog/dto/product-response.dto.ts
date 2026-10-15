import { ApiProperty } from '@nestjs/swagger';
import { ProductImageDto } from './product-image.dto.js';

export class SkuResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ nullable: true, type: String }) code!: string | null;
  @ApiProperty({ example: 150_000, description: 'Integer VND' }) price!: number;
  @ApiProperty({ example: 10 }) stock!: number;
  @ApiProperty({ example: ['Đen', 'M'], description: 'Option values, in option order' })
  optionValues!: string[];

  @ApiProperty({ description: 'False for a combination that exists but is not offered' })
  sellable!: boolean;
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
  @ApiProperty({ type: [ProductImageDto], description: 'Ordered; the first is the cover' })
  images!: ProductImageDto[];

  @ApiProperty({ nullable: true, type: Number }) weightGrams!: number | null;
  @ApiProperty({ nullable: true, type: Number }) lengthCm!: number | null;
  @ApiProperty({ nullable: true, type: Number }) widthCm!: number | null;
  @ApiProperty({ nullable: true, type: Number }) heightCm!: number | null;
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
  @ApiProperty({ example: 6 }) skuCount!: number;
  @ApiProperty({ example: ['Màu sắc', 'Size'], description: 'Option group names, in order' })
  optionNames!: string[];
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ nullable: true, type: String }) coverImageUrl!: string | null;
  @ApiProperty({ nullable: true, type: String }) coverImageAlt!: string | null;
}

export class StorefrontProductListItemDto extends ProductListItemDto {
  @ApiProperty({ example: 'Tai Store' }) shopName!: string;
  @ApiProperty({ example: 'tai-store' }) shopSlug!: string;
}

export class StorefrontProductDetailDto extends ProductDetailDto {
  @ApiProperty({ example: 'Tai Store' }) shopName!: string;
  @ApiProperty({ example: 'tai-store' }) shopSlug!: string;
}

/**
 * Concrete page shapes. A generic CursorPageDto<T> is invisible to Swagger — the
 * contract would describe the endpoint as returning nothing, and the generated
 * client would type the response as `never`.
 */
export class ProductListPageDto {
  @ApiProperty({ type: [ProductListItemDto] }) items!: ProductListItemDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

/**
 * The storefront page carries the two totals the listing header states ("96 sản phẩm
 * từ 31 shop") and the "đang xem 8 / 96" line under the grid. They cost one count
 * query over the same filters, and without them a cursor-paginated list cannot tell
 * the shopper how much is left.
 */
export class StorefrontProductListPageDto {
  @ApiProperty({ type: [StorefrontProductListItemDto] }) items!: StorefrontProductListItemDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
  @ApiProperty({ example: 96, description: 'Products matching the filters, ignoring the cursor' })
  total!: number;
  @ApiProperty({ example: 31, description: 'Distinct shops among those products' })
  shopCount!: number;
}

/** Tab counters for the product list screen. */
export class ProductSummaryDto {
  @ApiProperty({ example: 4 }) active!: number;
  @ApiProperty({ example: 2 }) draft!: number;
  @ApiProperty({ example: 0 }) hidden!: number;
  @ApiProperty({ example: 1 }) archived!: number;
}
