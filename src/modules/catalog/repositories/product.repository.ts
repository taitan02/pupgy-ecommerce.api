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
  updatedAt: true,
  weightGrams: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  options: {
    orderBy: { position: 'asc' },
    select: { name: true, values: { orderBy: { position: 'asc' }, select: { id: true, value: true } } },
  },
  images: {
    orderBy: { position: 'asc' },
    select: { id: true, storageKey: true, alt: true, position: true },
  },
  skus: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      code: true,
      price: true,
      stock: true,
      isSellable: true,
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
  updatedAt: true,
  shop: { select: { name: true, slug: true } },
  // The list shows "6 SKU · Màu sắc × Size", so it needs the axis names but not
  // their values.
  options: { orderBy: { position: 'asc' }, select: { name: true } },
  skus: { select: { price: true, stock: true } },
  // Only the cover: a listing shows one image per product, so fetching the rest
  // would be payload nobody renders.
  images: { orderBy: { position: 'asc' }, take: 1, select: { storageKey: true, alt: true } },
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

  listForSeller(params: {
    cursor?: string;
    limit: number;
    status?: ProductStatus;
    query?: string;
    categoryId?: string;
    sort?: 'updated' | 'created' | 'name';
  }) {
    const query = params.query?.trim();

    return this.prisma.product.findMany({
      where: {
        shopId: RequestContext.requireShopId(),
        status: params.status,
        categoryId: params.categoryId,
        // Sellers look for a product either by what they called it or by the code
        // they printed on the box. Proper Vietnamese search (unaccent + trigram)
        // arrives with the storefront search work; this is the honest interim.
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { skus: { some: { code: { contains: query, mode: 'insensitive' as const } } } },
              ],
            }
          : {}),
      },
      orderBy: orderByFor(params.sort),
      // Prisma's own cursor, so sorting by something other than id still paginates
      // correctly: every ordering ends with id, which makes it unique.
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: LIST_SELECT,
    });
  }

  /** One grouped query instead of one request per tab. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.product.groupBy({
      by: ['status'],
      where: { shopId: RequestContext.requireShopId() },
      _count: { _all: true },
    });

    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  async delete(productId: string): Promise<boolean> {
    const result = await this.prisma.product.deleteMany({
      where: { id: productId, shopId: RequestContext.requireShopId() },
    });
    return result.count === 1;
  }

  async updateShipping(
    productId: string,
    data: { weightGrams?: number; lengthCm?: number; widthCm?: number; heightCm?: number },
  ): Promise<boolean> {
    const result = await this.prisma.product.updateMany({
      where: { id: productId, shopId: RequestContext.requireShopId() },
      data,
    });
    return result.count === 1;
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
      },
      orderBy: { id: 'desc' },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: LIST_SELECT,
    });
  }
}

function orderByFor(sort: 'updated' | 'created' | 'name' | undefined) {
  switch (sort) {
    case 'created':
      // Ids are UUIDv7, so ordering by id is ordering by creation time.
      return [{ id: 'desc' as const }];
    case 'name':
      return [{ name: 'asc' as const }, { id: 'desc' as const }];
    default:
      return [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];
  }
}
