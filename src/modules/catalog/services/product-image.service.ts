import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { ProductImageRepository } from '../repositories/product-image.repository.js';
import { ProductRepository } from '../repositories/product.repository.js';
import { StorageService } from '../../../infra/storage/storage.service.js';
import { RequestContext } from '../../../common/context/request-context.js';
import { AppError } from '../../../common/errors/app-error.js';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGES_PER_PRODUCT,
  MAX_IMAGE_BYTES,
  type ProductImageDto,
} from '../dto/product-image.dto.js';

const UPLOAD_URL_TTL_SECONDS = 300;

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class ProductImageService {
  constructor(
    private readonly images: ProductImageRepository,
    private readonly products: ProductRepository,
    private readonly storage: StorageService,
  ) {}

  async createUploadUrl(productId: string, contentType: string) {
    await this.requireOwnProduct(productId);

    if ((await this.images.countForProduct(productId)) >= MAX_IMAGES_PER_PRODUCT) {
      throw AppError.conflict(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
    }

    // The shop id comes from the authorised context, so a merchant cannot craft a key
    // that writes into another shop's prefix.
    const shopId = RequestContext.requireShopId();
    const key = `shops/${shopId}/products/${productId}/${uuidv7()}.${EXTENSION[contentType]}`;

    return {
      uploadUrl: await this.storage.createUploadUrl(key, contentType, UPLOAD_URL_TTL_SECONDS),
      key,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      maxBytes: MAX_IMAGE_BYTES,
    };
  }

  /**
   * Called after the browser has uploaded. This is where the file is actually
   * checked: a presigned PUT cannot enforce a size limit, so a client could sign a
   * URL for a small JPEG and upload a 2 GB file. We ask the store what landed, and
   * delete anything that does not belong.
   */
  async register(productId: string, key: string, alt?: string): Promise<ProductImageDto> {
    await this.requireOwnProduct(productId);

    const shopId = RequestContext.requireShopId();
    if (!key.startsWith(`shops/${shopId}/products/${productId}/`)) {
      // The key is client-supplied, so it is checked rather than trusted.
      throw AppError.forbidden('This key does not belong to your product');
    }

    const object = await this.storage.head(key);
    if (!object) throw AppError.notFound('No uploaded file found for this key');

    if (!ALLOWED_IMAGE_TYPES.includes(object.contentType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
      await this.storage.delete(key);
      throw AppError.conflict(`Unsupported file type: ${object.contentType}`);
    }

    if (object.sizeBytes > MAX_IMAGE_BYTES) {
      await this.storage.delete(key);
      throw AppError.conflict(`File is larger than ${MAX_IMAGE_BYTES} bytes`);
    }

    if ((await this.images.countForProduct(productId)) >= MAX_IMAGES_PER_PRODUCT) {
      await this.storage.delete(key);
      throw AppError.conflict(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} images`);
    }

    const image = await this.images.create({
      id: uuidv7(),
      productId,
      storageKey: key,
      contentType: object.contentType,
      sizeBytes: object.sizeBytes,
      alt,
      position: await this.images.nextPosition(productId),
    });

    return this.toDto(image);
  }

  async remove(productId: string, imageId: string): Promise<void> {
    const image = await this.images.findForSeller(productId, imageId);
    if (!image) throw AppError.notFound('Image not found');

    // Row first: an orphaned object wastes a few kilobytes, while a row pointing at a
    // deleted object shows the customer a broken image.
    await this.images.delete(imageId);
    await this.storage.delete(image.storageKey);
  }

  toDto(image: { id: string; storageKey: string; alt: string | null; position: number }): ProductImageDto {
    return {
      id: image.id,
      url: this.storage.publicUrl(image.storageKey),
      alt: image.alt,
      position: image.position,
    };
  }

  private async requireOwnProduct(productId: string): Promise<void> {
    if (!(await this.products.findForSeller(productId))) {
      throw AppError.notFound('Product not found');
    }
  }
}
