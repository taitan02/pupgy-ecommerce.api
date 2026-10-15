import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap/create-app.js';
import { createShop, registerUser, uniqueSlug, url, type TestSession } from './helpers/auth-helpers.js';

/**
 * Browsing a category: price filter, price sort, stock filter, and paging through a
 * price-sorted list. All four share one SQL query whose keyset runs over an aggregate,
 * which is the part worth testing — an off-by-one there silently skips or repeats
 * products in the middle of a listing, where nobody notices.
 */
describe('Storefront browse (e2e)', () => {
  let app: NestExpressApplication;
  let seller: TestSession;
  let shopId: string;
  let shopSlug: string;
  let categorySlug: string;
  let parentSlug: string;
  let categoryId: string;

  const priced: Record<string, string> = {};

  beforeAll(async () => {
    app = await createApp();
    await app.init();

    seller = await registerUser(app, 'SELLER');
    shopSlug = uniqueSlug('browse-shop');
    shopId = await createShop(app, seller, shopSlug);

    const categories = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
    const parent = categories.body.at(-1);
    parentSlug = parent.slug;
    categorySlug = parent.children[0].slug;
    categoryId = parent.children[0].id;

    // Distinct prices, inserted out of order so a passing sort cannot be insertion
    // order in disguise.
    priced.mid = await publish('Ví da nam cao cấp', [300_000]);
    priced.cheap = await publish('Ví da nữ mini', [100_000]);
    priced.expensive = await publish('Ví da cá sấu', [900_000]);
    priced.range = await publishRange('Ví da bò nhiều màu', [150_000, 650_000]);
    priced.soldOut = await publish('Ví da đã hết hàng', [200_000], 0);
  });

  afterAll(async () => {
    await app.close();
  });

  async function publish(name: string, prices: number[], stock = 7): Promise<string> {
    return create(name, {
      skus: prices.map((price) => ({ optionValues: [], price, stock })),
    });
  }

  /** Two prices need two SKUs, and two SKUs need an option axis to tell them apart. */
  async function publishRange(name: string, prices: number[]): Promise<string> {
    const colours = ['Đen', 'Nâu'];
    return create(name, {
      options: [{ name: 'Màu sắc', values: colours }],
      skus: prices.map((price, index) => ({ optionValues: [colours[index]], price, stock: 7 })),
    });
  }

  async function create(name: string, body: Record<string, unknown>): Promise<string> {
    const created = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ name, slug: uniqueSlug('p'), categoryId, ...body })
      .expect(201);

    await request(app.getHttpServer())
      .patch(url(`/seller/products/${created.body.id}`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ status: 'ACTIVE' })
      .expect(200);

    return created.body.id;
  }

  const browse = (query: Record<string, string | number | boolean>) =>
    request(app.getHttpServer())
      .get(url('/storefront/products'))
      .query({ shopSlug, limit: 50, ...query });

  const ids = (body: { items: { id: string }[] }) => body.items.map((item) => item.id);

  describe('price sort', () => {
    it('orders by the cheapest SKU, ascending', async () => {
      const response = await browse({ sort: 'price_asc' }).expect(200);

      expect(ids(response.body)).toEqual([
        priced.cheap,
        priced.range,
        priced.soldOut,
        priced.mid,
        priced.expensive,
      ]);
    });

    it('orders by the cheapest SKU, descending', async () => {
      const response = await browse({ sort: 'price_desc' }).expect(200);

      // The multi-SKU product sorts on 150.000, its minimum — not on 650.000.
      expect(ids(response.body)).toEqual([
        priced.expensive,
        priced.mid,
        priced.soldOut,
        priced.range,
        priced.cheap,
      ]);
    });

    it('defaults to newest, which is the reverse of insertion', async () => {
      const response = await browse({}).expect(200);

      expect(ids(response.body)).toEqual([
        priced.soldOut,
        priced.range,
        priced.expensive,
        priced.cheap,
        priced.mid,
      ]);
    });

    it('pages a price-sorted list without skipping or repeating', async () => {
      const first = await browse({ sort: 'price_asc', limit: 2 }).expect(200);
      expect(ids(first.body)).toEqual([priced.cheap, priced.range]);
      expect(first.body.nextCursor).toBe(priced.range);

      const second = await browse({ sort: 'price_asc', limit: 2, cursor: first.body.nextCursor }).expect(
        200,
      );
      expect(ids(second.body)).toEqual([priced.soldOut, priced.mid]);

      const third = await browse({ sort: 'price_asc', limit: 2, cursor: second.body.nextCursor }).expect(
        200,
      );
      expect(ids(third.body)).toEqual([priced.expensive]);
      expect(third.body.nextCursor).toBeNull();
    });
  });

  describe('price filter', () => {
    it('keeps a product when any of its SKUs is in the range', async () => {
      const response = await browse({ minPrice: 600_000, maxPrice: 700_000 }).expect(200);

      // 150.000–650.000: the minimum is far below the range, one SKU is inside it.
      expect(ids(response.body)).toEqual([priced.range]);
    });

    it('treats a missing bound as open-ended', async () => {
      const response = await browse({ minPrice: 800_000 }).expect(200);
      expect(ids(response.body)).toEqual([priced.expensive]);

      const below = await browse({ maxPrice: 120_000 }).expect(200);
      expect(ids(below.body)).toEqual([priced.cheap]);
    });

    it('returns an empty page rather than an error when nothing matches', async () => {
      const response = await browse({ minPrice: 5_000_000 }).expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
      expect(response.body.nextCursor).toBeNull();
    });
  });

  describe('stock filter', () => {
    it('drops a product whose every SKU is out of stock', async () => {
      const response = await browse({ inStock: true }).expect(200);

      expect(ids(response.body)).not.toContain(priced.soldOut);
      expect(ids(response.body)).toContain(priced.cheap);
    });

    it('keeps it when the filter is off', async () => {
      const response = await browse({}).expect(200);
      expect(ids(response.body)).toContain(priced.soldOut);
    });
  });

  describe('totals', () => {
    it('counts the matching products and the shops behind them, not the page', async () => {
      const response = await browse({ limit: 2 }).expect(200);

      expect(response.body.items).toHaveLength(2);
      expect(response.body.total).toBe(5);
      expect(response.body.shopCount).toBe(1);
    });

    it('narrows with the filters', async () => {
      const response = await browse({ inStock: true }).expect(200);
      expect(response.body.total).toBe(4);
    });
  });

  describe('category branch', () => {
    it('lists a parent category by including its children', async () => {
      const response = await request(app.getHttpServer())
        .get(url('/storefront/products'))
        .query({ categorySlug: parentSlug, shopSlug, limit: 50 })
        .expect(200);

      expect(ids(response.body)).toContain(priced.cheap);
    });

    it('reports a product count on the category tree', async () => {
      const response = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
      const parent = response.body.find((node: { slug: string }) => node.slug === parentSlug);
      const child = parent.children.find((node: { slug: string }) => node.slug === categorySlug);

      expect(child.productCount).toBeGreaterThanOrEqual(5);
      // A parent's count is the sum of its branch: products hang off leaves.
      expect(parent.productCount).toBeGreaterThanOrEqual(child.productCount);
    });

    it('404s for a category that does not exist', async () => {
      await request(app.getHttpServer())
        .get(url('/storefront/products'))
        .query({ categorySlug: 'khong-ton-tai' })
        .expect(404);
    });
  });

  describe('rejected input', () => {
    it('refuses an unknown sort instead of falling back to a default', async () => {
      await browse({ sort: 'cheapest' }).expect(400);
    });

    it('refuses a negative price', async () => {
      await browse({ minPrice: -1 }).expect(400);
    });
  });
});
