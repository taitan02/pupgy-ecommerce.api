import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap/create-app.js';
import { createShop, registerUser, uniqueSlug, url, type TestSession } from './helpers/auth-helpers.js';

interface PublishedProduct {
  productId: string;
  skuIds: string[];
}

describe('Cart (e2e)', () => {
  let app: NestExpressApplication;
  let buyer: TestSession;
  let sellerA: TestSession;
  let sellerB: TestSession;
  let shopA: string;
  let shopB: string;
  let categoryId: string;

  beforeAll(async () => {
    app = await createApp();
    await app.init();

    buyer = await registerUser(app, 'STOREFRONT');
    sellerA = await registerUser(app, 'SELLER');
    sellerB = await registerUser(app, 'SELLER');
    shopA = await createShop(app, sellerA, uniqueSlug('cart-a'));
    shopB = await createShop(app, sellerB, uniqueSlug('cart-b'));

    const categories = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
    categoryId = categories.body[0].children[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function publish(
    seller: TestSession,
    shopId: string,
    name: string,
    stock = 10,
  ): Promise<PublishedProduct> {
    const created = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({
        name,
        slug: uniqueSlug('p'),
        categoryId,
        skus: [{ optionValues: [], price: 459_000, stock }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(url(`/seller/products/${created.body.id}`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ status: 'ACTIVE' })
      .expect(200);

    return { productId: created.body.id, skuIds: created.body.skus.map((sku: { id: string }) => sku.id) };
  }

  const setStock = (seller: TestSession, shopId: string, product: PublishedProduct, stock: number) =>
    request(app.getHttpServer())
      .patch(url(`/seller/products/${product.productId}/skus/${product.skuIds[0]}`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ stock })
      .expect(200);

  const cartOf = (session: TestSession) =>
    request(app.getHttpServer())
      .get(url('/storefront/cart'))
      .set('Authorization', `Bearer ${session.accessToken}`);

  const addTo = (session: TestSession, skuId: string, quantity = 1) =>
    request(app.getHttpServer())
      .post(url('/storefront/cart/items'))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ skuId, quantity });

  it('starts empty', async () => {
    const response = await cartOf(buyer).expect(200);
    expect(response.body).toEqual({ groups: [], itemCount: 0 });
  });

  it('adds a line and prices it from the SKU', async () => {
    const product = await publish(sellerA, shopA, 'Áo khoác gió nam');
    const response = await addTo(buyer, product.skuIds[0]!, 2).expect(201);

    expect(response.body.itemCount).toBe(1);
    const [group] = response.body.groups;
    expect(group.shopId).toBe(shopA);
    expect(group.items[0].unitPrice).toBe(459_000);
    expect(group.items[0].lineTotal).toBe(918_000);
    expect(group.subtotal).toBe(918_000);
    expect(group.subtotalQuantity).toBe(2);
    expect(group.checkoutBlocked).toBe(false);
  });

  it('increases the quantity instead of creating a second line for the same SKU', async () => {
    const cart = await cartOf(buyer).expect(200);
    const skuId = cart.body.groups[0].items[0].skuId;

    const response = await addTo(buyer, skuId, 1).expect(201);

    expect(response.body.itemCount).toBe(1);
    expect(response.body.groups[0].items[0].quantity).toBe(3);
  });

  it('groups by shop, most recently added shop first', async () => {
    const product = await publish(sellerB, shopB, 'Nồi chiên không dầu');
    const response = await addTo(buyer, product.skuIds[0]!, 1).expect(201);

    expect(response.body.groups.map((group: { shopId: string }) => group.shopId)).toEqual([
      shopB,
      shopA,
    ]);
    // No grand total anywhere in the payload: each shop is paid separately (ADR-001).
    expect(response.body).not.toHaveProperty('total');
  });

  it('refuses to add more than the shop has', async () => {
    const product = await publish(sellerA, shopA, 'Bộ dao nhà bếp', 2);
    const response = await addTo(buyer, product.skuIds[0]!, 5).expect(409);

    expect(response.body.code).toBe('CONFLICT');
    expect(response.body.availableStock).toBe(2);
  });

  it('flags a line when stock drops below it, and keeps the chosen quantity', async () => {
    const product = await publish(sellerA, shopA, 'Áo thun cotton', 10);
    await addTo(buyer, product.skuIds[0]!, 3).expect(201);
    await setStock(sellerA, shopA, product, 2);

    const cart = await cartOf(buyer).expect(200);
    const group = cart.body.groups.find((candidate: { shopId: string }) => candidate.shopId === shopA);
    const line = group.items.find((item: { skuId: string }) => item.skuId === product.skuIds[0]);

    expect(line.quantity).toBe(3); // never lowered behind the shopper's back
    expect(line.issue).toBe('INSUFFICIENT_STOCK');
    expect(line.availableStock).toBe(2);
    expect(group.checkoutBlocked).toBe(true);
    expect(group.subtotal).toBeGreaterThanOrEqual(line.lineTotal);
  });

  it('lets the shopper accept the available quantity, which unblocks the group', async () => {
    const cart = await cartOf(buyer).expect(200);
    const group = cart.body.groups.find((candidate: { shopId: string }) => candidate.shopId === shopA);
    const blocked = group.items.find(
      (item: { issue: string | null }) => item.issue === 'INSUFFICIENT_STOCK',
    );

    const response = await request(app.getHttpServer())
      .patch(url(`/storefront/cart/items/${blocked.id}`))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ quantity: blocked.availableStock })
      .expect(200);

    const updated = response.body.groups.find(
      (candidate: { shopId: string }) => candidate.shopId === shopA,
    );
    expect(updated.items.every((item: { issue: string | null }) => item.issue === null)).toBe(true);
    expect(updated.checkoutBlocked).toBe(false);
  });

  it('keeps a withdrawn listing visible but out of the subtotal, without blocking the rest', async () => {
    const product = await publish(sellerB, shopB, 'Đèn bàn LED', 5);
    await addTo(buyer, product.skuIds[0]!, 1).expect(201);

    await request(app.getHttpServer())
      .patch(url(`/seller/products/${product.productId}`))
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .set('x-shop-id', shopB)
      .send({ status: 'ARCHIVED' })
      .expect(200);

    const cart = await cartOf(buyer).expect(200);
    const group = cart.body.groups.find((candidate: { shopId: string }) => candidate.shopId === shopB);
    const line = group.items.find((item: { skuId: string }) => item.skuId === product.skuIds[0]);

    expect(line.issue).toBe('UNAVAILABLE');
    expect(group.subtotal).toBe(
      group.items
        .filter((item: { issue: string | null }) => item.issue === null)
        .reduce((total: number, item: { lineTotal: number }) => total + item.lineTotal, 0),
    );
    expect(group.checkoutBlocked).toBe(false);
  });

  it('refuses to add a listing that is not on sale', async () => {
    const product = await publish(sellerB, shopB, 'Ấm đun nước', 5);
    await request(app.getHttpServer())
      .patch(url(`/seller/products/${product.productId}`))
      .set('Authorization', `Bearer ${sellerB.accessToken}`)
      .set('x-shop-id', shopB)
      .send({ status: 'HIDDEN' })
      .expect(200);

    await addTo(buyer, product.skuIds[0]!, 1).expect(404);
  });

  it('removes a line', async () => {
    const cart = await cartOf(buyer).expect(200);
    const line = cart.body.groups[0].items[0];

    const response = await request(app.getHttpServer())
      .delete(url(`/storefront/cart/items/${line.id}`))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    expect(response.body.itemCount).toBe(cart.body.itemCount - 1);
  });

  it('counts lines for the header badge', async () => {
    const cart = await cartOf(buyer).expect(200);
    const response = await request(app.getHttpServer())
      .get(url('/storefront/cart/count'))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200);

    expect(response.body.itemCount).toBe(cart.body.itemCount);
  });

  it('keeps carts apart between shoppers', async () => {
    const stranger = await registerUser(app, 'STOREFRONT');
    const mine = await cartOf(buyer).expect(200);

    const theirs = await cartOf(stranger).expect(200);
    expect(theirs.body.itemCount).toBe(0);

    await request(app.getHttpServer())
      .patch(url(`/storefront/cart/items/${mine.body.groups[0].items[0].id}`))
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({ quantity: 1 })
      .expect(404);
  });

  it('rejects a seller token', async () => {
    await cartOf(sellerA).expect(403);
  });
});
