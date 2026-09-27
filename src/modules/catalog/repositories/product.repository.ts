import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { RequestContext } from '../../../common/context/request-context.js';
import type { ProductStatus } from '../../../generated/prisma/enums.js';

/** Everything a product page needs, in one query. */
const DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  categoryId: true,
  status: true,
  shop: { select: { name: true, slug: true } },
  options: {
    orderBy: { position: 'asc' },
    select: { name: true, values: { orderBy: { position: 'asc' }, select: { id: true, value: true } } },
  },
  skus: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      code: true,
      price: true,
      stock: true,
      optionValue1: { select: { value: true } },
      optionValue2: { select: { value: true } },
    },
  },
} as const;

const LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  shop: { select: { name: true, slug: true } },
  skus: { select: { price: true, stock: true } },
} as const;

export interface CreateProductData {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description?: string;
  options: { id: string; name: string; position: number; values: { id: string; value: string; position: number }[] }[];
  skus: { id: string; price: number; stock: number; code?: string; optionValue1Id?: string; optionValue2Id?: string }[];
}

/**
 * The only place catalog data is queried.
 *
 * Seller methods take the shop from RequestContext, never from an argument: there is
 * no way for a caller to ask for another shop's products (ADR-006). Storefront
 * methods are deliberately not shop-scoped — a marketplace's catalog is public — but
 * they only ever return ACTIVE products of ACTIVE shops.
 */
@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- seller (shop-scoped) ----------

  async create(data: CreateProductData) {
    const shopId = RequestContext.requireShopId();

    return this.prisma.$transaction(async (tx) => {
      await tx.product.create({
        data: {
          id: data.id,
          shopId,
          categoryId: data.categoryId,
          name: data.name,
          slug: data.slug,
          description: data.description,
          options: {
            create: data.options.map((option) => ({
              id: option.id,
              shopId,
              name: option.name,
              position: option.position,
              values: {
                create: option.values.map((value) => ({
                  id: value.id,
                  shopId,
                  value: value.value,
                  position: value.position,
                })),
              },
            })),
          },
        },
      });

      // Separate insert: the SKUs reference option value ids created just above.
      await tx.sku.createMany({
        data: data.skus.map((sku) => ({ ...sku, shopId, productId: data.id })),
      });

      return tx.product.findUniqueOrThrow({ where: { id: data.id }, select: DETAIL_SELECT });
    });
  }

  findForSeller(productId: string) {
    return this.prisma.product.findFirst({
      where: { id: productId, shopId: RequestContext.requireShopId() },
      select: DETAIL_SELECT,
    });
  }

  listForSeller(params: { cursor?: string; limit: number; status?: ProductStatus }) {
    return this.prisma.product.findMany({
      where: {
        shopId: RequestContext.requireShopId(),
        status: params.status,
        ...(params.cursor ? { id: { lt: params.cursor } } : {}),
      },
      // Newest first. Ids are UUIDv7, so ordering by id is ordering by creation time
      // and the cursor needs no second column.
      orderBy: { id: 'desc' },
      take: params.limit + 1,
      select: LIST_SELECT,
    });
  }

  async update(productId: string, data: { name?: string; description?: string; categoryId?: string; status?: ProductStatus }) {
    const result = await this.prisma.product.updateMany({
      where: { id: productId, shopId: RequestContext.requireShopId() },
      data,
    });
    return result.count === 1;
  }

  async updateSku(skuId: string, data: { price?: number; stock?: number; code?: string }) {
    const result = await this.prisma.sku.updateMany({
      where: { id: skuId, shopId: RequestContext.requireShopId() },
      data,
    });
    return result.count === 1;
  }

  slugExists(slug: string) {
    return this.prisma.product.findFirst({
      where: { shopId: RequestContext.requireShopId(), slug },
      select: { id: true },
    });
  }

  // ---------- storefront (public) ----------

  findPublic(productId: string) {
    return this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE', shop: { status: 'ACTIVE' } },
      select: DETAIL_SELECT,
    });
  }

  listPublic(params: { cursor?: string; limit: number; categoryId?: string; shopSlug?: string }) {
    return this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        shop: { status: 'ACTIVE', slug: params.shopSlug },
        categoryId: params.categoryId,
        ...(params.cursor ? { id: { lt: params.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: params.limit + 1,
      select: LIST_SELECT,
    });
  }
}
