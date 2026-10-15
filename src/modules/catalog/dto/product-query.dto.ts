import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CursorQueryDto } from '../../../common/dto/cursor-page.dto.js';
import { ProductStatusDto } from './product.dto.js';

export enum StorefrontSortDto {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
}

export enum ProductSortDto {
  UPDATED = 'updated',
  CREATED = 'created',
  NAME = 'name',
}

/**
 * All query parameters live in one DTO because the global ValidationPipe runs with
 * `forbidNonWhitelisted`: anything not declared here is rejected, which is the
 * behaviour we want — but it means filters cannot be picked up as loose @Query('x')
 * arguments on the side.
 */
export class SellerProductQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({ enum: ProductStatusDto })
  @IsOptional()
  @IsEnum(ProductStatusDto)
  status?: ProductStatusDto;

  @ApiPropertyOptional({ description: 'Matches the product name or a SKU code' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ProductSortDto, default: ProductSortDto.UPDATED })
  @IsOptional()
  @IsEnum(ProductSortDto)
  sort?: ProductSortDto;
}

export class StorefrontProductQueryDto extends CursorQueryDto {
  @ApiPropertyOptional({
    example: 'ao khoac',
    description: 'Accent-insensitive: "ao khoac" matches "Áo khoác"',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ example: 'ao-nam' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  categorySlug?: string;

  @ApiPropertyOptional({ example: 'tai-store' })
  @IsOptional()
  @IsString()
  @MaxLength(140)
  shopSlug?: string;

  @ApiPropertyOptional({ enum: StorefrontSortDto, default: StorefrontSortDto.NEWEST })
  @IsOptional()
  @IsEnum(StorefrontSortDto)
  sort?: StorefrontSortDto;

  @ApiPropertyOptional({
    example: 150_000,
    description: 'Integer VND. A product matches when any of its SKUs falls in the range.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 500_000, description: 'Integer VND' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'Keep only products with at least one sellable SKU in stock' })
  @IsOptional()
  // The pipe's implicit conversion has already turned "true" into true by the time
  // this runs; the string arms are for the "1" that hand-built links carry.
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  inStock?: boolean;
}
