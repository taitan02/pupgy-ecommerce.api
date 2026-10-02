import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { createShop, registerUser, uniqueSlug, url, type TestSession, createTestApp } from './helpers/auth-helpers.js';

describe('Orders (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let buyer: TestSession;
  let otherBuyer: TestSession;
  let seller: TestSession;
  let shopId: string;
  let categoryId: string;
  let addressId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    buyer = await registerUser(app, 'STOREFRONT');
    otherBuyer = await registerUser(app, 'STOREFRONT');
    seller = await registerUser(app, 'SELLER');
    shopId = await createShop(app, seller, uniqueSlug('orders'));

    const categories = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
    categoryId = categories.body[0].children[0].id;

    addressId = await createAddress(buyer);
  });

  // Each test builds the cart it needs. Without this, a line left behind by one test
  // is silently part of the next test's order — and one blocked line blocks every
  // checkout after it.
  beforeEach(async () => {
    await prisma.cartItem.deleteMany({
      where: { userId: { in: [buyer.userId, otherBuyer.userId] } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------- helpers ----------

  async function createAddress(session: TestSession): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(url('/storefront/addresses'))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        recipientName: 'Nguyễn Văn A',
        phone: '0901234567',
        provinceName: 'TP. Hồ Chí Minh',
        wardName: 'Phường Bến Nghé',
        streetLine: '12 Nguyễn Huệ',
      })
      .expect(201);
    return response.body.id;
  }

  /** A published product with one SKU, which is what an order needs. */
  async function publish(name: string, stock: number, price = 200_000): Promise<string> {
    const created = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ name, slug: uniqueSlug('p'), categoryId, skus: [{ optionValues: [], price, stock }] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(url(`/seller/products/${created.body.id}`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ status: 'ACTIVE' })
      .expect(200);

    return created.body.skus[0].id;
  }

  const addToCart = (session: TestSession, skuId: string, quantity = 1) =>
    request(app.getHttpServer())
      .post(url('/storefront/cart/items'))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ skuId, quantity });

  const placeOrder = (session: TestSession, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(url('/storefront/orders'))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ shopId, paymentMethod: 'COD', idempotencyKey: randomUUID(), ...body });

  const sellerAction = (orderId: string, action: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(url(`/seller/orders/${orderId}/${action}`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send(body);

  const stockOf = async (skuId: string) =>
    (await prisma.sku.findUniqueOrThrow({ where: { id: skuId }, select: { stock: true } })).stock;

  // ---------- checkout ----------

  describe('checkout', () => {
    it('quotes the shop group from live catalog data', async () => {
      const skuId = await publish('Bình giữ nhiệt', 10, 350_000);
      await addToCart(buyer, skuId, 2).expect(201);

      const response = await request(app.getHttpServer())
        .post(url('/storefront/checkout/preview'))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ shopId })
        .expect(200);

      expect(response.body.itemsSubtotal).toBe(700_000);
      expect(response.body.total).toBe(response.body.itemsSubtotal + response.body.shippingFee);
      expect(response.body.address.recipientName).toBe('Nguyễn Văn A'); // default pre-selected
      expect(response.body.blocked).toBe(false);
    });

    it('places the order, takes the stock and clears those cart lines', async () => {
      const skuId = await publish('Đèn bàn LED', 8, 500_000);
      await addToCart(buyer, skuId, 3).expect(201);

      const response = await placeOrder(buyer, { addressId }).expect(201);

      expect(response.body.order.status).toBe('PENDING');
      expect(response.body.order.paymentStatus).toBe('UNPAID');
      expect(response.body.order.code).toMatch(/^PG\d{6}-[A-Z2-9]{6}$/);
      expect(response.body.order.itemsSubtotal).toBe(1_500_000);
      expect(await stockOf(skuId)).toBe(5);

      const cart = await request(app.getHttpServer())
        .get(url('/storefront/cart'))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      expect(cart.body.groups.flatMap((g: { items: unknown[] }) => g.items)).toHaveLength(0);
    });

    it('records the movement that took the stock', async () => {
      const skuId = await publish('Tai nghe', 4);
      await addToCart(buyer, skuId, 2).expect(201);
      const response = await placeOrder(buyer, { addressId }).expect(201);

      const movements = await prisma.inventoryMovement.findMany({ where: { skuId } });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ delta: -2, reason: 'ORDER_PLACED', stockAfter: 2 });
      expect(movements[0]!.orderId).toBe(response.body.order.id);
    });

    it('snapshots the product name, so renaming it later does not rewrite the order', async () => {
      const skuId = await publish('Tên lúc đặt hàng', 5);
      await addToCart(buyer, skuId).expect(201);
      const placed = await placeOrder(buyer, { addressId }).expect(201);

      const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId }, select: { productId: true } });
      await request(app.getHttpServer())
        .patch(url(`/seller/products/${sku.productId}`))
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .set('x-shop-id', shopId)
        .send({ name: 'Tên đã đổi sau đó' })
        .expect(200);

      const order = await request(app.getHttpServer())
        .get(url(`/storefront/orders/${placed.body.order.id}`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      expect(order.body.items[0].productName).toBe('Tên lúc đặt hàng');
    });

    it('returns the first order when the same idempotency key is submitted twice', async () => {
      const skuId = await publish('Chuột không dây', 10);
      await addToCart(buyer, skuId, 1).expect(201);

      const idempotencyKey = randomUUID();
      const first = await placeOrder(buyer, { addressId, idempotencyKey }).expect(201);
      const second = await placeOrder(buyer, { addressId, idempotencyKey }).expect(201);

      expect(second.body.order.id).toBe(first.body.order.id);
      expect(await stockOf(skuId)).toBe(9); // charged once, not twice
    });

    it('refuses when a line no longer has enough stock', async () => {
      const skuId = await publish('Hàng sắp hết', 5);
      await addToCart(buyer, skuId, 5).expect(201);

      await request(app.getHttpServer())
        .patch(url(`/seller/products/${await productOf(skuId)}/skus/${skuId}`))
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .set('x-shop-id', shopId)
        .send({ stock: 2 })
        .expect(200);

      const response = await placeOrder(buyer, { addressId }).expect(409);
      expect(response.body.items[0]).toMatchObject({ skuId, issue: 'INSUFFICIENT_STOCK' });
      expect(await stockOf(skuId)).toBe(2); // nothing taken
    });

    it('refuses an address that belongs to someone else', async () => {
      const skuId = await publish('Đồ chơi', 3);
      await addToCart(buyer, skuId).expect(201);

      const theirs = await createAddress(otherBuyer);
      await placeOrder(buyer, { addressId: theirs }).expect(404);
    });
  });

  // ---------- the race ----------

  describe('concurrency', () => {
    it('sells the last unit exactly once when two buyers order at the same time', async () => {
      // The point of the conditional UPDATE (ADR-012): both requests pass their own
      // "is there stock?" check, and Postgres decides which one gets the unit.
      const skuId = await publish('Món cuối cùng', 1);
      const theirAddress = await createAddress(otherBuyer);

      await addToCart(buyer, skuId, 1).expect(201);
      await addToCart(otherBuyer, skuId, 1).expect(201);

      const [a, b] = await Promise.all([
        placeOrder(buyer, { addressId }),
        placeOrder(otherBuyer, { addressId: theirAddress }),
      ]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([201, 409]);
      expect(await stockOf(skuId)).toBe(0);

      const movements = await prisma.inventoryMovement.findMany({ where: { skuId } });
      expect(movements).toHaveLength(1);
    });
  });

  // ---------- state machine ----------

  describe('state machine', () => {
    async function placedOrder(stock = 5, quantity = 2): Promise<string> {
      const skuId = await publish('Sản phẩm để test trạng thái', stock);
      await addToCart(buyer, skuId, quantity).expect(201);
      const response = await placeOrder(buyer, { addressId }).expect(201);
      return response.body.order.id;
    }

    it('walks PENDING → CONFIRMED → SHIPPING → DELIVERED and marks COD paid on delivery', async () => {
      const orderId = await placedOrder();

      expect((await sellerAction(orderId, 'confirm').expect(200)).body.status).toBe('CONFIRMED');
      expect((await sellerAction(orderId, 'ship').expect(200)).body.status).toBe('SHIPPING');

      const delivered = await sellerAction(orderId, 'deliver').expect(200);
      expect(delivered.body.status).toBe('DELIVERED');
      expect(delivered.body.paymentStatus).toBe('PAID');
      expect(delivered.body.deliveredAt).not.toBeNull();
    });

    it('refuses to skip a state', async () => {
      const orderId = await placedOrder();
      await sellerAction(orderId, 'ship').expect(409);
    });

    it('refuses to move a delivered order', async () => {
      const orderId = await placedOrder();
      await sellerAction(orderId, 'confirm').expect(200);
      await sellerAction(orderId, 'ship').expect(200);
      await sellerAction(orderId, 'deliver').expect(200);

      await sellerAction(orderId, 'cancel').expect(409);
    });

    it('tells the client which transitions it may offer', async () => {
      const orderId = await placedOrder();

      const forSeller = await request(app.getHttpServer())
        .get(url(`/seller/orders/${orderId}`))
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .set('x-shop-id', shopId)
        .expect(200);
      expect(forSeller.body.allowedTransitions).toEqual(['CONFIRMED', 'CANCELLED']);

      const forBuyer = await request(app.getHttpServer())
        .get(url(`/storefront/orders/${orderId}`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      expect(forBuyer.body.allowedTransitions).toEqual(['CANCELLED']);
    });
  });

  // ---------- cancelling ----------

  describe('cancelling', () => {
    it('gives the stock back and records why', async () => {
      const skuId = await publish('Hàng sẽ huỷ', 10);
      await addToCart(buyer, skuId, 3).expect(201);
      const placed = await placeOrder(buyer, { addressId }).expect(201);
      expect(await stockOf(skuId)).toBe(7);

      const cancelled = await request(app.getHttpServer())
        .post(url(`/storefront/orders/${placed.body.order.id}/cancel`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ reason: 'Đặt nhầm size' })
        .expect(200);

      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.cancelledBy).toBe('BUYER');
      expect(cancelled.body.cancelReason).toBe('Đặt nhầm size');
      expect(await stockOf(skuId)).toBe(10);

      const movements = await prisma.inventoryMovement.findMany({
        where: { skuId },
        orderBy: { id: 'asc' },
      });
      expect(movements.map((m) => m.reason)).toEqual(['ORDER_PLACED', 'ORDER_CANCELLED']);
      expect(movements.at(-1)).toMatchObject({ delta: 3, stockAfter: 10 });
    });

    it('stops the buyer cancelling once the shop has confirmed', async () => {
      const skuId = await publish('Đã xác nhận rồi', 5);
      await addToCart(buyer, skuId).expect(201);
      const placed = await placeOrder(buyer, { addressId }).expect(201);
      await sellerAction(placed.body.order.id, 'confirm').expect(200);

      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${placed.body.order.id}/cancel`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({})
        .expect(409);
    });

    it('lets the shop cancel a confirmed order and restock it', async () => {
      const skuId = await publish('Shop từ chối', 6);
      await addToCart(buyer, skuId, 2).expect(201);
      const placed = await placeOrder(buyer, { addressId }).expect(201);
      await sellerAction(placed.body.order.id, 'confirm').expect(200);

      const cancelled = await sellerAction(placed.body.order.id, 'cancel', { reason: 'Hết hàng' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.cancelledBy).toBe('SELLER');
      expect(await stockOf(skuId)).toBe(6);
    });
  });

  // ---------- isolation ----------

  describe('isolation', () => {
    it('hides another buyer’s order', async () => {
      const skuId = await publish('Riêng tư', 5);
      await addToCart(buyer, skuId).expect(201);
      const placed = await placeOrder(buyer, { addressId }).expect(201);

      await request(app.getHttpServer())
        .get(url(`/storefront/orders/${placed.body.order.id}`))
        .set('Authorization', `Bearer ${otherBuyer.accessToken}`)
        .expect(404);
    });

    it('hides the order from another shop', async () => {
      const skuId = await publish('Của shop này', 5);
      await addToCart(buyer, skuId).expect(201);
      const placed = await placeOrder(buyer, { addressId }).expect(201);

      const outsider = await registerUser(app, 'SELLER');
      const otherShop = await createShop(app, outsider, uniqueSlug('outsider'));

      await request(app.getHttpServer())
        .get(url(`/seller/orders/${placed.body.order.id}`))
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .set('x-shop-id', otherShop)
        .expect(404);
    });

    it('refuses a storefront token on the seller endpoints', async () => {
      await request(app.getHttpServer())
        .get(url('/seller/orders'))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .set('x-shop-id', shopId)
        .expect(403);
    });
  });

  // ---------- the catalog side ----------

  describe('catalog', () => {
    it('refuses to delete a product that has been ordered', async () => {
      const skuId = await publish('Đã bán rồi', 5);
      await addToCart(buyer, skuId).expect(201);
      await placeOrder(buyer, { addressId }).expect(201);

      const response = await request(app.getHttpServer())
        .delete(url(`/seller/products/${await productOf(skuId)}`))
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .set('x-shop-id', shopId)
        .expect(409);

      expect(response.body.detail).toContain('archive');
    });
  });

  // ---------- seller list ----------

  describe('seller list', () => {
    it('counts orders per status for the tabs', async () => {
      const response = await request(app.getHttpServer())
        .get(url('/seller/orders/summary'))
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .set('x-shop-id', shopId)
        .expect(200);

      expect(response.body.pending + response.body.cancelled + response.body.delivered).toBeGreaterThan(0);
    });

    it('filters by status', async () => {
      const response = await request(app.getHttpServer())
        .get(url('/seller/orders'))
        .query({ status: 'DELIVERED', limit: 50 })
        .set('Authorization', `Bearer ${seller.accessToken}`)
        .set('x-shop-id', shopId)
        .expect(200);

      expect(response.body.items.every((item: { status: string }) => item.status === 'DELIVERED')).toBe(true);
    });
  });

  async function productOf(skuId: string): Promise<string> {
    const sku = await prisma.sku.findUniqueOrThrow({
      where: { id: skuId },
      select: { productId: true },
    });
    return sku.productId;
  }
});
