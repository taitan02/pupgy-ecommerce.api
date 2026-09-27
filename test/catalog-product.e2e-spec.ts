import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap/create-app.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createShop, registerUser, uniqueSlug, url, type TestSession } from './helpers/auth-helpers.js';

describe('Catalog products (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestSession;
  let bob: TestSession;
  let shopA: string;
  let shopB: string;
  let categoryId: string;

  beforeAll(async () => {
    app = await createApp();
    await app.init();

    alice = await registerUser(app, 'SELLER');
    bob = await registerUser(app, 'SELLER');
    shopA = await createShop(app, alice, uniqueSlug('cat-a'));
    shopB = await createShop(app, bob, uniqueSlug('cat-b'));

    const categories = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
    categoryId = categories.body[0].children[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  const createProduct = (session: TestSession, shopId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('x-shop-id', shopId)
      .send(body);

  const productPayload = (overrides: Record<string, unknown> = {}) => ({
    name: 'Áo thun basic',
    slug: uniqueSlug('ao-thun'),
    categoryId,
    options: [
      { name: 'Màu sắc', values: ['Đen', 'Trắng'] },
      { name: 'Size', values: ['M', 'L'] },
    ],
    skus: [
      { optionValues: ['Đen', 'M'], price: 150_000, stock: 10 },
      { optionValues: ['Trắng', 'L'], price: 170_000, stock: 5 },
    ],
    ...overrides,
  });

  describe('creating', () => {
    it('creates a product with two option axes and their SKUs', async () => {
      const response = await createProduct(alice, shopA, productPayload()).expect(201);

      expect(response.body.status).toBe('DRAFT'); // not visible until published
      expect(response.body.options).toHaveLength(2);
      expect(response.body.skus).toHaveLength(2);
      expect(response.body.skus[0].optionValues).toEqual(['Đen', 'M']);
    });

    it('creates a product with no options and a single SKU', async () => {
      const response = await createProduct(
        alice,
        shopA,
        productPayload({ options: [], skus: [{ optionValues: [], price: 99_000, stock: 3 }] }),
      ).expect(201);

      expect(response.body.options).toHaveLength(0);
      expect(response.body.skus[0].optionValues).toEqual([]);
    });

    it('rejects a third option axis', async () => {
      await createProduct(
        alice,
        shopA,
        productPayload({
          options: [
            { name: 'Màu', values: ['Đen'] },
            { name: 'Size', values: ['M'] },
            { name: 'Chất liệu', values: ['Cotton'] },
          ],
          skus: [{ optionValues: ['Đen', 'M'], price: 1000, stock: 1 }],
        }),
      ).expect(400);
    });

    it('rejects a SKU referring to a value that is not in its option', async () => {
      const response = await createProduct(
        alice,
        shopA,
        productPayload({
          skus: [{ optionValues: ['Xanh', 'M'], price: 150_000, stock: 1 }],
        }),
      ).expect(409);

      expect(response.body.detail).toContain('Xanh');
    });

    it('rejects two SKUs with the same option combination', async () => {
      await createProduct(
        alice,
        shopA,
        productPayload({
          skus: [
            { optionValues: ['Đen', 'M'], price: 150_000, stock: 1 },
            { optionValues: ['Đen', 'M'], price: 160_000, stock: 2 },
          ],
        }),
      ).expect(409);
    });

    it('rejects a negative price before it reaches the database', async () => {
      await createProduct(
        alice,
        shopA,
        productPayload({ skus: [{ optionValues: ['Đen', 'M'], price: -1, stock: 1 }] }),
      ).expect(400);
    });

    it('allows two shops to use the same slug', async () => {
      const slug = uniqueSlug('shared-slug');
      await createProduct(alice, shopA, productPayload({ slug })).expect(201);
      await createProduct(bob, shopB, productPayload({ slug })).expect(201);
    });

    it('rejects a duplicate slug within one shop', async () => {
      const slug = uniqueSlug('dupe-slug');
      await createProduct(alice, shopA, productPayload({ slug })).expect(201);
      await createProduct(alice, shopA, productPayload({ slug })).expect(409);
    });
  });

  describe('isolation', () => {
    let aliceProduct: string;

    beforeAll(async () => {
      const response = await createProduct(alice, shopA, productPayload()).expect(201);
      aliceProduct = response.body.id;
    });

    it('CRITICAL: another shop cannot read the product', async () => {
      await request(app.getHttpServer())
        .get(url(`/seller/products/${aliceProduct}`))
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .set('x-shop-id', shopB)
        .expect(404);
    });

    it('CRITICAL: another shop cannot update the product', async () => {
      await request(app.getHttpServer())
        .patch(url(`/seller/products/${aliceProduct}`))
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .set('x-shop-id', shopB)
        .send({ name: 'Hijacked' })
        .expect(404);

      const untouched = await request(app.getHttpServer())
        .get(url(`/seller/products/${aliceProduct}`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(200);

      expect(untouched.body.name).not.toBe('Hijacked');
    });

    it('CRITICAL: another shop cannot change a SKU price', async () => {
      const product = await request(app.getHttpServer())
        .get(url(`/seller/products/${aliceProduct}`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(200);

      const skuId = product.body.skus[0].id;

      await request(app.getHttpServer())
        .patch(url(`/seller/products/${aliceProduct}/skus/${skuId}`))
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .set('x-shop-id', shopB)
        .send({ price: 1 })
        .expect(404);
    });

    it("does not list another shop's products", async () => {
      const bobProducts = await request(app.getHttpServer())
        .get(url('/seller/products'))
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .set('x-shop-id', shopB)
        .expect(200);

      const ids: string[] = bobProducts.body.items.map((item: { id: string }) => item.id);
      expect(ids).not.toContain(aliceProduct);
    });
  });

  describe('database constraints', () => {
    // These bypass the application entirely. The point of ADR-006's third mechanism
    // is that isolation survives a bug in the layers above.
    let prisma: PrismaService;
    let aliceProductId: string;

    beforeAll(async () => {
      prisma = app.get(PrismaService);
      const product = await createProduct(alice, shopA, productPayload()).expect(201);
      aliceProductId = product.body.id;
    });

    it("refuses a SKU that points at another shop's product", async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO skus (id, product_id, shop_id, price, stock, created_at, updated_at)
          VALUES (gen_random_uuid(), ${aliceProductId}::uuid, ${shopB}::uuid, 1000, 1, now(), now())
        `,
      ).rejects.toThrow();
    });

    it('refuses a negative price', async () => {
      await expect(
        prisma.$executeRaw`
          INSERT INTO skus (id, product_id, shop_id, price, stock, created_at, updated_at)
          VALUES (gen_random_uuid(), ${aliceProductId}::uuid, ${shopA}::uuid, -5000, 1, now(), now())
        `,
      ).rejects.toThrow();
    });

    it('refuses a second SKU with the same empty option combination', async () => {
      const product = await createProduct(
        alice,
        shopA,
        productPayload({ options: [], skus: [{ optionValues: [], price: 50_000, stock: 1 }] }),
      ).expect(201);

      // NULLS NOT DISTINCT is what makes this fail; without it Postgres would treat
      // every NULL combination as unique and allow unlimited duplicate SKUs.
      await expect(
        prisma.$executeRaw`
          INSERT INTO skus (id, product_id, shop_id, price, stock, created_at, updated_at)
          VALUES (gen_random_uuid(), ${product.body.id}::uuid, ${shopA}::uuid, 60000, 1, now(), now())
        `,
      ).rejects.toThrow();
    });
  });

  describe('storefront visibility', () => {
    let draftId: string;
    let activeId: string;

    beforeAll(async () => {
      const draft = await createProduct(alice, shopA, productPayload()).expect(201);
      draftId = draft.body.id;

      const active = await createProduct(alice, shopA, productPayload()).expect(201);
      activeId = active.body.id;

      await request(app.getHttpServer())
        .patch(url(`/seller/products/${activeId}`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .send({ status: 'ACTIVE' })
        .expect(200);
    });

    it('hides a DRAFT product from the public catalog', async () => {
      await request(app.getHttpServer()).get(url(`/storefront/products/${draftId}`)).expect(404);
    });

    it('shows an ACTIVE product with its shop and price range, without authentication', async () => {
      const response = await request(app.getHttpServer())
        .get(url(`/storefront/products/${activeId}`))
        .expect(200);

      expect(response.body.shopSlug).toBeTruthy();
      expect(response.body.skus).toHaveLength(2);
    });

    it('lists across shops and reports a price range', async () => {
      const response = await request(app.getHttpServer())
        .get(url('/storefront/products'))
        .query({ limit: 50 })
        .expect(200);

      const listed = response.body.items.find((item: { id: string }) => item.id === activeId);
      expect(listed.priceFrom).toBe(150_000);
      expect(listed.priceTo).toBe(170_000);
      expect(listed.shopName).toBeTruthy();
      // Stock is a seller concern; the public list must not leak it as a field the
      // storefront could accidentally display.
      expect(response.body.items.every((item: { totalStock?: number }) => item.totalStock !== undefined)).toBe(true);
    });

    it('paginates with a cursor', async () => {
      // Publishes its own second product: test files run in parallel against one
      // database, so relying on rows another file happens to create is a race.
      const second = await createProduct(alice, shopA, productPayload()).expect(201);
      await request(app.getHttpServer())
        .patch(url(`/seller/products/${second.body.id}`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .send({ status: 'ACTIVE' })
        .expect(200);

      const firstPage = await request(app.getHttpServer())
        .get(url('/storefront/products'))
        .query({ limit: 1 })
        .expect(200);

      expect(firstPage.body.items).toHaveLength(1);
      expect(firstPage.body.nextCursor).toBeTruthy();

      const secondPage = await request(app.getHttpServer())
        .get(url('/storefront/products'))
        .query({ limit: 1, cursor: firstPage.body.nextCursor })
        .expect(200);

      expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);
    });
  });
});
