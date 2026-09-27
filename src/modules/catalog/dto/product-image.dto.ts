import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Formats a browser can display and a merchant is likely to have. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 8;

export class CreateUploadUrlDto {
  @ApiProperty({ enum: ALLOWED_IMAGE_TYPES })
  @IsIn(ALLOWED_IMAGE_TYPES)
  contentType!: string;
}

export class UploadUrlResponseDto {
  @ApiProperty({ description: 'PUT the file here directly, with the same Content-Type' })
  uploadUrl!: string;

  @ApiProperty({ description: 'Send this back when registering the image' })
  key!: string;

  @ApiProperty({ example: 300 })
  expiresInSeconds!: number;

  @ApiProperty({ example: MAX_IMAGE_BYTES, description: 'Larger uploads are rejected on registration' })
  maxBytes!: number;
}

export class RegisterImageDto {
  @ApiProperty({ description: 'The key returned by the upload-url endpoint' })
  @IsString()
  @MaxLength(400)
  key!: string;

  @ApiPropertyOptional({ description: 'Alt text. Worth filling in: it is read by screen readers and by search engines.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  alt?: string;
}

export class ProductImageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'https://cdn.example.com/shops/…/photo.jpg' }) url!: string;
  @ApiProperty({ nullable: true, type: String }) alt!: string | null;
  @ApiProperty({ example: 0, description: '0 is the cover image' }) position!: number;
}
