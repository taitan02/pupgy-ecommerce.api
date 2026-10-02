import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShop, registerUser, uniqueSlug, url, type TestSession, createTestApp } from './helpers/auth-helpers.js';

describe('Product variations (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestSession;
  let bob: TestSession;
  let shopA: string;
  let shopB: string;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();

    alice = await registerUser(app, 'SELLER');
    bob = await registerUser(app, 'SELLER');
    shopA = await createShop(app, alice, uniqueSlug('var-a'));
    shopB = await createShop(app, bob, uniqueSlug('var-b'));

    const categories = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
    categoryId = categories.body[0].children[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  const seller = (session: TestSession, shopId: string) => ({ session, shopId });

  async function createProduct(twoAxes = true) {
    // SKU codes are unique per shop, so each product in this suite needs its own.
    const code = uniqueSlug('AKG').toUpperCase();
    const body = twoAxes
      ? {
          name: 'Áo khoác gió nam',
          slug: uniqueSlug('ao-khoac'),
          categoryId,
          options: [
            { name: 'Màu sắc', values: ['Đen', 'Xanh navy'] },
            { name: 'Size', values: ['M', 'L'] },
          ],
          skus: [
            { optionValues: ['Đen', 'M'], price: 459_000, stock: 24, code: `${code}-DEN-M` },
            { optionValues: ['Đen', 'L'], price: 459_000, stock: 18, code: `${code}-DEN-L` },
            { optionValues: ['Xanh navy', 'M'], price: 459_000, stock: 0, code: `${code}-XAN-M` },
            { optionValues: ['Xanh navy', 'L'], price: 489_000, stock: 12, code: `${code}-XAN-L` },
          ],
        }
      : {
          name: 'Mũ bảo hiểm',
          slug: uniqueSlug('mu-bao-hiem'),
          categoryId,
          skus: [{ optionValues: [], price: 245_000, stock: 3 }],
        };

    const response = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopA)
      .send(body)
      .expect(201);

    return response.body;
  }

  const replaceVariations = (productId: string, body: Record<string, unknown>, actor = seller(alice, shopA)) =>
    request(app.getHttpServer())
      .put(url(`/seller/products/${productId}/variations`))
      .set('Authorization', `Bearer ${actor.session.accessToken}`)
      .set('x-shop-id', actor.shopId)
      .send(body);

  const skuIdByLabels = (product: { skus: { id: string; optionValues: string[] }[] }) =>
    new Map(product.skus.map((sku) => [sku.optionValues.join(' · '), sku.id]));

  it('keeps SKU ids for combinations that still exist when a value is added', async () => {
    const product = await createProduct();
    const before = skuIdByLabels(product);

    const updated = await replaceVariations(product.id, {
      options: [
        { name: 'Màu sắc', values: ['Đen', 'Xanh navy', 'Rêu'] },
        { name: 'Size', values: ['M', 'L'] },
      ],
      skus: [
        ...product.skus.map((sku: { optionValues: string[]; price: number; stock: number }) => ({
          optionValues: sku.optionValues,
          price: sku.price,
          stock: sku.stock,
        })),
        { optionValues: ['Rêu', 'M'], price: 479_000, stock: 5 },
      ],
    }).expect(200);

    const after = skuIdByLabels(updated.body);
    expect(after.size).toBe(5);
    // Carts and order items point at SKU ids, so an edit must not silently detach
    // a customer's cart from the variant they chose.
    expect(after.get('Đen · M')).toBe(before.get('Đen · M'));
    expect(after.get('Xanh navy · L')).toBe(before.get('Xanh navy · L'));
  });

  it('merges SKUs when an option group is removed', async () => {
    const product = await createProduct();
    const before = skuIdByLabels(product);

    // Dropping "Size" leaves one SKU per colour, exactly as the seller is warned.
    const updated = await replaceVariations(product.id, {
      options: [{ name: 'Màu sắc', values: ['Đen', 'Xanh navy'] }],
      skus: [
        { optionValues: ['Đen'], price: 459_000, stock: 42 },
        { optionValues: ['Xanh navy'], price: 489_000, stock: 12 },
      ],
    }).expect(200);

    expect(updated.body.options).toHaveLength(1);
    expect(updated.body.skus).toHaveLength(2);
    // The combinations changed, so these are new SKUs — the old ids are gone.
    const after = skuIdByLabels(updated.body);
    expect([...after.values()]).not.toContain(before.get('Đen · M'));
  });

  it('keeps SKU ids when only the group name is renamed', async () => {
    const product = await createProduct();
    const before = skuIdByLabels(product);

    const updated = await replaceVariations(product.id, {
      options: [
        { name: 'Màu', values: ['Đen', 'Xanh navy'] },
        { name: 'Size', values: ['M', 'L'] },
      ],
      skus: product.skus.map((sku: { optionValues: string[]; price: number; stock: number }) => ({
        optionValues: sku.optionValues,
        price: sku.price,
        stock: sku.stock,
      })),
    }).expect(200);

    expect(updated.body.options[0].name).toBe('Màu');
    expect(skuIdByLabels(updated.body).get('Đen · M')).toBe(before.get('Đen · M'));
  });

  it('drops the SKUs of a removed value', async () => {
    const product = await createProduct();

    const updated = await replaceVariations(product.id, {
      options: [
        { name: 'Màu sắc', values: ['Đen'] },
        { name: 'Size', values: ['M', 'L'] },
      ],
      skus: [
        { optionValues: ['Đen', 'M'], price: 459_000, stock: 24 },
        { optionValues: ['Đen', 'L'], price: 459_000, stock: 18 },
      ],
    }).expect(200);

    expect(updated.body.skus).toHaveLength(2);
    expect(updated.body.options[0].values).toEqual(['Đen']);
  });

  it('can move a product from no options to two axes and back', async () => {
    const product = await createProduct(false);
    expect(product.skus).toHaveLength(1);

    const withAxes = await replaceVariations(product.id, {
      options: [{ name: 'Màu sắc', values: ['Đen', 'Trắng'] }],
      skus: [
        { optionValues: ['Đen'], price: 245_000, stock: 3 },
        { optionValues: ['Trắng'], price: 245_000, stock: 2 },
      ],
    }).expect(200);
    expect(withAxes.body.skus).toHaveLength(2);

    const backToPlain = await replaceVariations(product.id, {
      options: [],
      skus: [{ optionValues: [], price: 255_000, stock: 5 }],
    }).expect(200);

    expect(backToPlain.body.options).toHaveLength(0);
    expect(backToPlain.body.skus).toHaveLength(1);
    expect(backToPlain.body.skus[0].price).toBe(255_000);
  });

  it('marks a combination as not sellable without deleting it', async () => {
    const product = await createProduct();

    const updated = await replaceVariations(product.id, {
      options: [
        { name: 'Màu sắc', values: ['Đen', 'Xanh navy'] },
        { name: 'Size', values: ['M', 'L'] },
      ],
      skus: product.skus.map((sku: { optionValues: string[]; price: number; stock: number }) => ({
        optionValues: sku.optionValues,
        price: sku.price,
        stock: sku.stock,
        sellable: sku.optionValues.join() !== 'Xanh navy,M',
      })),
    }).expect(200);

    const unsellable = updated.body.skus.find(
      (sku: { optionValues: string[] }) => sku.optionValues.join() === 'Xanh navy,M',
    );
    expect(unsellable.sellable).toBe(false);
    expect(updated.body.skus).toHaveLength(4);
  });

  it('rejects a third option group', async () => {
    const product = await createProduct();

    await replaceVariations(product.id, {
      options: [
        { name: 'Màu sắc', values: ['Đen'] },
        { name: 'Size', values: ['M'] },
        { name: 'Chất liệu', values: ['Cotton'] },
      ],
      skus: [{ optionValues: ['Đen', 'M'], price: 1000, stock: 1 }],
    }).expect(400);
  });

  it('CRITICAL: another shop cannot replace the variations', async () => {
    const product = await createProduct();

    await replaceVariations(
      product.id,
      {
        options: [],
        skus: [{ optionValues: [], price: 1, stock: 999 }],
      },
      seller(bob, shopB),
    ).expect(404);
  });

  describe('shipping and deletion', () => {
    it('stores weight and dimensions', async () => {
      const product = await createProduct();

      const updated = await request(app.getHttpServer())
        .patch(url(`/seller/products/${product.id}/shipping`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .send({ weightGrams: 650, lengthCm: 30, widthCm: 25, heightCm: 4 })
        .expect(200);

      expect(updated.body.weightGrams).toBe(650);
    });

    it('rejects a zero weight at the database boundary', async () => {
      const product = await createProduct();

      await request(app.getHttpServer())
        .patch(url(`/seller/products/${product.id}/shipping`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .send({ weightGrams: 0 })
        .expect(400);
    });

    it('deletes a product and everything under it', async () => {
      const product = await createProduct();

      await request(app.getHttpServer())
        .delete(url(`/seller/products/${product.id}`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(204);

      await request(app.getHttpServer())
        .get(url(`/seller/products/${product.id}`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(404);
    });

    it('refuses deletion by STAFF', async () => {
      const product = await createProduct();
      const staff = await registerUser(app, 'SELLER');

      await request(app.getHttpServer())
        .post(url('/seller/shops/current/members'))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .send({ email: staff.email, role: 'STAFF' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(url(`/seller/products/${product.id}`))
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(403);
    });
  });

  describe('list filters', () => {
    it('finds a product by name fragment and by SKU code', async () => {
      const product = await createProduct();
      const skuCode: string = product.skus[0].code;

      const byName = await request(app.getHttpServer())
        .get(url('/seller/products'))
        .query({ q: 'khoác gió' })
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(200);
      expect(byName.body.items.some((item: { id: string }) => item.id === product.id)).toBe(true);

      const byCode = await request(app.getHttpServer())
        .get(url('/seller/products'))
        .query({ q: skuCode.slice(0, 12) })
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(200);
      expect(byCode.body.items.some((item: { id: string }) => item.id === product.id)).toBe(true);
    });

    it('returns the summary fields the list screen renders', async () => {
      await createProduct();

      const response = await request(app.getHttpServer())
        .get(url('/seller/products'))
        .query({ sort: 'updated', limit: 1 })
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(200);

      const item = response.body.items[0];
      expect(item.skuCount).toBeGreaterThan(0);
      expect(item.optionNames).toEqual(['Màu sắc', 'Size']);
      expect(item.updatedAt).toBeTruthy();
    });
  });
});
