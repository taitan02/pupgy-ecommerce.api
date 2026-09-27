import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { RequestContext } from '../../../common/context/request-context.js';

export interface ImageRow {
  id: string;
  storageKey: string;
  alt: string | null;
  position: number;
}

@Injectable()
export class ProductImageRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    id: string;
    productId: string;
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    alt?: string;
    position: number;
  }): Promise<ImageRow> {
    return this.prisma.productImage.create({
      data: { ...data, shopId: RequestContext.requireShopId() },
      select: { id: true, storageKey: true, alt: true, position: true },
    });
  }

  countForProduct(productId: string): Promise<number> {
    return this.prisma.productImage.count({
      where: { productId, shopId: RequestContext.requireShopId() },
    });
  }

  async nextPosition(productId: string): Promise<number> {
    const last = await this.prisma.productImage.findFirst({
      where: { productId, shopId: RequestContext.requireShopId() },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last ? last.position + 1 : 0;
  }

  /** Returns the row so the caller can delete the object too. */
  async findForSeller(productId: string, imageId: string): Promise<ImageRow | null> {
    return this.prisma.productImage.findFirst({
      where: { id: imageId, productId, shopId: RequestContext.requireShopId() },
      select: { id: true, storageKey: true, alt: true, position: true },
    });
  }

  /** Used when a product is deleted: the rows cascade, the stored files do not. */
  async listKeysForProduct(productId: string): Promise<string[]> {
    const images = await this.prisma.productImage.findMany({
      where: { productId, shopId: RequestContext.requireShopId() },
      select: { storageKey: true },
    });
    return images.map((image) => image.storageKey);
  }

  async delete(imageId: string): Promise<void> {
    await this.prisma.productImage.deleteMany({
      where: { id: imageId, shopId: RequestContext.requireShopId() },
    });
  }
}
