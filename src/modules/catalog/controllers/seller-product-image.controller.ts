import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductImageService } from '../services/product-image.service.js';
import {
  CreateUploadUrlDto,
  ProductImageDto,
  RegisterImageDto,
  UploadUrlResponseDto,
} from '../dto/product-image.dto.js';
import { ShopGuard, SHOP_HEADER } from '../../../common/guards/shop.guard.js';
import { RequireAudience, RequireRoles } from '../../../common/decorators/auth.decorators.js';

/**
 * Two-step upload: the browser gets a short-lived URL and sends the bytes straight to
 * object storage, then tells us the key. The file never passes through this process.
 */
@ApiTags('seller/product-images')
@ApiBearerAuth('access-token')
@ApiHeader({ name: SHOP_HEADER, required: true })
@RequireAudience('SELLER')
@RequireRoles('OWNER', 'STAFF')
@UseGuards(ShopGuard)
@Controller('seller/products/:productId/images')
export class SellerProductImageController {
  constructor(private readonly images: ProductImageService) {}

  @Post('upload-url')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get a presigned URL to upload one image' })
  @ApiOkResponse({ type: UploadUrlResponseDto })
  createUploadUrl(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    return this.images.createUploadUrl(productId, dto.contentType);
  }

  @Post()
  @ApiOperation({ summary: 'Register an uploaded image after the file has been sent' })
  @ApiOkResponse({ type: ProductImageDto })
  register(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: RegisterImageDto,
  ): Promise<ProductImageDto> {
    return this.images.register(productId, dto.key, dto.alt);
  }

  @Delete(':imageId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove an image and delete the stored file' })
  remove(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ): Promise<void> {
    return this.images.remove(productId, imageId);
  }
}
