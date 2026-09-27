import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export enum ProductStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  HIDDEN = 'HIDDEN',
  ARCHIVED = 'ARCHIVED',
}

// One billion VND: a sanity bound, not a business rule. It stops a typo (a price
// pasted with extra zeros) from reaching the database.
const MAX_PRICE_VND = 1_000_000_000;

export class ProductOptionInput {
  @ApiProperty({ example: 'Màu sắc' })
  @IsString()
  @Length(1, 60)
  name!: string;

  @ApiProperty({ example: ['Đen', 'Trắng'], maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  values!: string[];
}

export class SkuInput {
  @ApiProperty({
    example: ['Đen', 'M'],
    description: 'One value per option, in option order. Empty for a product with no options.',
  })
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  optionValues!: string[];

  @ApiProperty({ example: 150_000, description: 'Integer VND' })
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_VND)
  price!: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({ example: 'AT-DEN-M', description: "Merchant's own code, unique per shop" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'False for a combination that exists in the grid but is not offered',
  })
  @IsOptional()
  @IsBoolean()
  sellable?: boolean;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Áo thun basic' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ example: 'ao-thun-basic', description: 'Unique within the shop' })
  @Matches(/^[a-z0-9][a-z0-9-]{1,218}[a-z0-9]$/, {
    message: 'slug must be lowercase letters, digits or dashes',
  })
  slug!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ type: [ProductOptionInput], maxItems: 2 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionInput)
  options?: ProductOptionInput[];

  @ApiProperty({ type: [SkuInput], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SkuInput)
  skus!: SkuInput[];
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: ProductStatusDto })
  @IsOptional()
  @IsEnum(ProductStatusDto)
  status?: ProductStatusDto;
}

export class UpdateSkuDto {
  @ApiPropertyOptional({ example: 160_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_VND)
  price?: number;

  @ApiPropertyOptional({ example: 25, description: 'Absolute value. Phase 7 adds safe adjustments.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;
}
