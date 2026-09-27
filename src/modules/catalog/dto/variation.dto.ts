import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProductOptionInput } from './product.dto.js';

const MAX_PRICE_VND = 1_000_000_000;

export class VariationSkuInput {
  @ApiProperty({ example: ['Đen', 'M'], description: 'One value per option, in option order' })
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  optionValues!: string[];

  @ApiProperty({ example: 459_000 })
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_VND)
  price!: number;

  @ApiProperty({ example: 24 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiPropertyOptional({ example: 'AKG-DEN-M' })
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

/**
 * Replaces the whole variation structure in one request.
 *
 * Sent whole rather than as a set of add/remove operations: the seller edits a grid
 * and presses save, and a full replacement is far easier to reason about than a
 * sequence of partial edits that can interleave.
 */
export class ReplaceVariationsDto {
  @ApiPropertyOptional({ type: [ProductOptionInput], maxItems: 2 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionInput)
  options?: ProductOptionInput[];

  @ApiProperty({ type: [VariationSkuInput], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => VariationSkuInput)
  skus!: VariationSkuInput[];
}

export class UpdateShippingDto {
  @ApiPropertyOptional({ example: 650, description: 'Grams' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  weightGrams?: number;

  @ApiPropertyOptional({ example: 30, description: 'Centimetres' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  lengthCm?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  widthCm?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  heightCm?: number;
}
