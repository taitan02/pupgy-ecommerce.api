import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { ProductRepository } from '../repositories/product.repository.js';
import { CategoryRepository } from '../repositories/category.repository.js';
import { AppError } from '../../../common/errors/app-error.js';
import { toCursorPage, type CursorPageDto } from '../../../common/dto/cursor-page.dto.js';
import type { CreateProductDto, UpdateProductDto, UpdateSkuDto } from '../dto/product.dto.js';
import type {
  ProductDetailDto,
  ProductListItemDto,
  StorefrontProductDetailDto,
  StorefrontProductListItemDto,
} from '../dto/product-response.dto.js';
import type { ProductStatus } from '../../../generated/prisma/enums.js';

@Injectable()
export class ProductService {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryRepository,
  ) {}

  async create(dto: CreateProductDto): Promise<ProductDetailDto> {
    if (!(await this.categories.exists(dto.categoryId))) {
      throw AppError.notFound('Category not found');
    }
    if (await this.products.slugExists(dto.slug)) {
      throw AppError.conflict('A product with this slug already exists in your shop');
    }

    const options = (dto.options ?? []).map((option, index) => ({
      id: uuidv7(),
      name: option.name,
      position: index + 1,
      values: option.values.map((value, valueIndex) => ({
        id: uuidv7(),
        value,
        position: valueIndex + 1,
      })),
    }));

    validateOptions(options);

    // Option values were just given ids in memory; SKUs reference them by name.
    const valueIdByOptionAndName = options.map(
      (option) => new Map(option.values.map((value) => [value.value, value.id])),
    );

    const seenCombinations = new Set<string>();
    const skus = dto.skus.map((sku) => {
      if (sku.optionValues.length !== options.length) {
        throw AppError.conflict(
          `Each SKU must have exactly ${options.length} option value(s), in option order`,
        );
      }

      const valueIds = sku.optionValues.map((value, index) => {
        const id = valueIdByOptionAndName[index]!.get(value);
        if (!id) {
          throw AppError.conflict(`"${value}" is not a value of option "${options[index]!.name}"`);
        }
        return id;
      });

      const combination = valueIds.join('|');
      if (seenCombinations.has(combination)) {
        throw AppError.conflict('Two SKUs have the same option combination');
      }
      seenCombinations.add(combination);

      return {
        id: uuidv7(),
        price: sku.price,
        stock: sku.stock,
        code: sku.code,
        optionValue1Id: valueIds[0],
        optionValue2Id: valueIds[1],
      };
    });

    const created = await this.products.create({
      id: uuidv7(),
      categoryId: dto.categoryId,
      name: dto.name.trim(),
      slug: dto.slug,
      description: dto.description?.trim(),
      options,
      skus,
    });

    return toDetail(created);
  }

  async getForSeller(productId: string): Promise<ProductDetailDto> {
    const product = await this.products.findForSeller(productId);
    if (!product) throw AppError.notFound('Product not found');
    return toDetail(product);
  }

  async listForSeller(params: {
    cursor?: string;
    limit: number;
    status?: ProductStatus;
  }): Promise<CursorPageDto<ProductListItemDto>> {
    const rows = await this.products.listForSeller(params);
    return toCursorPage(rows.map(toListItem), params.limit);
  }

  async update(productId: string, dto: UpdateProductDto): Promise<ProductDetailDto> {
    if (dto.categoryId && !(await this.categories.exists(dto.categoryId))) {
      throw AppError.notFound('Category not found');
    }

    const updated = await this.products.update(productId, dto);
    if (!updated) throw AppError.notFound('Product not found');

    return this.getForSeller(productId);
  }

  async updateSku(productId: string, skuId: string, dto: UpdateSkuDto): Promise<ProductDetailDto> {
    // Confirms the SKU's product belongs to this shop before touching the SKU.
    const product = await this.products.findForSeller(productId);
    if (!product?.skus.some((sku) => sku.id === skuId)) {
      throw AppError.notFound('SKU not found');
    }

    await this.products.updateSku(skuId, dto);
    return this.getForSeller(productId);
  }

  // ---------- storefront ----------

  async getPublic(productId: string): Promise<StorefrontProductDetailDto> {
    const product = await this.products.findPublic(productId);
    // A DRAFT or HIDDEN product is 404 to the public, not 403: its existence is not
    // something the storefront should confirm.
    if (!product) throw AppError.notFound('Product not found');

    return { ...toDetail(product), shopName: product.shop.name, shopSlug: product.shop.slug };
  }

  async listPublic(params: {
    cursor?: string;
    limit: number;
    categorySlug?: string;
    shopSlug?: string;
  }): Promise<CursorPageDto<StorefrontProductListItemDto>> {
    let categoryId: string | undefined;
    if (params.categorySlug) {
      const category = await this.categories.findBySlug(params.categorySlug);
      if (!category) throw AppError.notFound('Category not found');
      categoryId = category.id;
    }

    const rows = await this.products.listPublic({ ...params, categoryId });
    const items = rows.map((row) => ({
      ...toListItem(row),
      shopName: row.shop.name,
      shopSlug: row.shop.slug,
    }));

    return toCursorPage(items, params.limit);
  }
}

function validateOptions(
  options: { name: string; values: { value: string }[] }[],
): void {
  const names = options.map((option) => option.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    throw AppError.conflict('Two options have the same name');
  }

  for (const option of options) {
    const values = option.values.map((value) => value.value.trim().toLowerCase());
    if (new Set(values).size !== values.length) {
      throw AppError.conflict(`Option "${option.name}" has duplicate values`);
    }
  }
}

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  categoryId: string;
  status: string;
  options: { name: string; values: { value: string }[] }[];
  skus: {
    id: string;
    code: string | null;
    price: number;
    stock: number;
    optionValue1: { value: string } | null;
    optionValue2: { value: string } | null;
  }[];
};

function toDetail(product: ProductRow) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    categoryId: product.categoryId,
    status: product.status,
    options: product.options.map((option) => ({
      name: option.name,
      values: option.values.map((value) => value.value),
    })),
    skus: product.skus.map((sku) => ({
      id: sku.id,
      code: sku.code,
      price: sku.price,
      stock: sku.stock,
      optionValues: [sku.optionValue1?.value, sku.optionValue2?.value].filter(
        (value): value is string => value !== undefined,
      ),
    })),
  };
}

function toListItem(row: {
  id: string;
  name: string;
  slug: string;
  status: string;
  skus: { price: number; stock: number }[];
}) {
  const prices = row.skus.map((sku) => sku.price);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    priceFrom: Math.min(...prices),
    priceTo: Math.max(...prices),
    totalStock: row.skus.reduce((total, sku) => total + sku.stock, 0),
  };
}
