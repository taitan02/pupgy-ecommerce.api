import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CursorQueryDto } from '../../../common/dto/cursor-page.dto.js';
import { ProductStatusDto } from './product.dto.js';

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
}
