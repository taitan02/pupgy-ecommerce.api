import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShop, registerUser, uniqueSlug, url, type TestSession, createTestApp } from './helpers/auth-helpers.js';

describe('Storefront search (e2e)', () => {
  let app: NestExpressApplication;
  let seller: TestSession;
  let shopId: string;
  let shopSlug: string;
  let categoryId: string;
  let jacketId: string;

  beforeAll(async () => {
    app = await createTestApp();

    seller = await registerUser(app, 'SELLER');
    shopSlug = uniqueSlug('search-shop');
    shopId = await createShop(app, seller, shopSlug);

    const categories = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
    categoryId = categories.body[0].children[0].id;

    jacketId = await publish('Áo khoác gió nam chống nước');
    await publish('Mũ bảo hiểm nửa đầu');
  });

  afterAll(async () => {
    await app.close();
  });

  async function publish(name: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({
        name,
        slug: uniqueSlug('p'),
        categoryId,
        skus: [{ optionValues: [], price: 459_000, stock: 5 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(url(`/seller/products/${created.body.id}`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ status: 'ACTIVE' })
      .expect(200);

    return created.body.id;
  }

  const search = (q: string) =>
    request(app.getHttpServer()).get(url('/storefront/products')).query({ q, limit: 50 });

  const ids = (body: { items: { id: string }[] }) => body.items.map((item) => item.id);

  it('finds a product typed without diacritics', async () => {
    // The whole point: Vietnamese keyboards are not always at hand, and nobody types
    // "Áo khoác" into a search box on a phone.
    const response = await search('ao khoac').expect(200);
    expect(ids(response.body)).toContain(jacketId);
  });

  it('finds a product typed with diacritics', async () => {
    const response = await search('áo khoác').expect(200);
    expect(ids(response.body)).toContain(jacketId);
  });

  it('matches a fragment in the middle of the name', async () => {
    const response = await search('chong nuoc').expect(200);
    expect(ids(response.body)).toContain(jacketId);
  });

  it('ignores case', async () => {
    const response = await search('AO KHOAC').expect(200);
    expect(ids(response.body)).toContain(jacketId);
  });

  it('excludes products that do not match', async () => {
    const response = await search('ao khoac').expect(200);
    const names: string[] = response.body.items.map((item: { name: string }) => item.name);
    expect(names.every((name) => name.toLowerCase().includes('kh'))).toBe(true);
  });

  it('returns nothing for a query with no matches', async () => {
    const response = await search('xyzzy-khong-co-gi').expect(200);
    expect(response.body.items).toHaveLength(0);
  });

  it('does not surface drafts', async () => {
    const draft = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({
        name: 'Áo khoác bản nháp chưa đăng',
        slug: uniqueSlug('draft'),
        categoryId,
        skus: [{ optionValues: [], price: 1000, stock: 1 }],
      })
      .expect(201);

    const response = await search('ao khoac').expect(200);
    expect(ids(response.body)).not.toContain(draft.body.id);
  });

  describe('sitemap', () => {
    it('lists indexable URLs in the shape the storefront routes use', async () => {
      const response = await request(app.getHttpServer()).get(url('/storefront/sitemap')).expect(200);

      expect(response.body.products.some((entry: { url: string }) => entry.url.endsWith(jacketId))).toBe(
        true,
      );
      expect(response.body.shops.some((entry: { url: string }) => entry.url === `/shops/${shopSlug}`)).toBe(
        true,
      );
      expect(response.body.categories.length).toBeGreaterThan(0);
    });
  });

  describe('public shop profile', () => {
    it('returns the shop without any seller-only fields', async () => {
      const response = await request(app.getHttpServer())
        .get(url(`/storefront/shops/${shopSlug}`))
        .expect(200);

      expect(response.body.slug).toBe(shopSlug);
      expect(response.body).not.toHaveProperty('status');
      expect(response.body).not.toHaveProperty('members');
    });

    it('404s for an unknown shop', async () => {
      await request(app.getHttpServer()).get(url('/storefront/shops/khong-ton-tai')).expect(404);
    });
  });
});
