import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { PAYMENT_QUEUE } from '../src/modules/payments/services/payment.queue.js';
import { MAIL_QUEUE } from '../src/modules/notifications/notification.types.js';
import { ReleaseService } from '../src/modules/payments/services/release.service.js';
import { PaymentExpiryService } from '../src/modules/payments/services/payment-expiry.service.js';
import { PaymentService } from '../src/modules/payments/services/payment.service.js';
import { OrderService } from '../src/modules/orders/services/order.service.js';
import { createShop, createTestApp, registerUser, uniqueSlug, url, type TestSession } from './helpers/auth-helpers.js';
import { signedWebhook } from './helpers/sepay.js';

/** Must match SEPAY_WEBHOOK_SECRET in .env.test. */
const WEBHOOK_SECRET = 'test-webhook-secret-not-a-real-one';
/** COMMISSION_RATE_BPS default: 5%. */
const RATE_BPS = 500;

describe('Escrow (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let release: ReleaseService;
  let expiry: PaymentExpiryService;

  let buyer: TestSession;
  let seller: TestSession;
  let shopId: string;
  let categoryId: string;
  let addressId: string;
  // Seeded from the clock: the provider transaction id is unique per payment event, so
  // a fixed series would be deduplicated against the previous run's rows and nothing
  // would settle.
  let transactionId = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    release = app.get(ReleaseService);
    // Built from the app's providers rather than by booting WorkerModule: starting a
    // second Nest context also starts a BullMQ worker whose timers outlive the suite.
    expiry = new PaymentExpiryService(app.get(PaymentService), app.get(OrderService));

    buyer = await registerUser(app, 'STOREFRONT');
    seller = await registerUser(app, 'SELLER');
    shopId = await createShop(app, seller, uniqueSlug('escrow'));

    const categories = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
    categoryId = categories.body[0].children[0].id;

    const address = await request(app.getHttpServer())
      .post(url('/storefront/addresses'))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        recipientName: 'Nguyễn Văn A',
        phone: '0901234567',
        provinceName: 'TP. Hồ Chí Minh',
        wardName: 'Phường Bến Nghé',
        streetLine: '12 Nguyễn Huệ',
      })
      .expect(201);
    addressId = address.body.id;
  });

  afterAll(async () => {
    for (const name of [PAYMENT_QUEUE, MAIL_QUEUE]) {
      await (app.get(getQueueToken(name)) as Queue).obliterate({ force: true });
    }
    await app.close();
  });

  beforeEach(async () => {
    await prisma.cartItem.deleteMany({ where: { userId: buyer.userId } });
  });

  // ---------- helpers ----------

  const sellerHeaders = () => ({ Authorization: `Bearer ${seller.accessToken}`, 'x-shop-id': shopId });
  const buyerAuth = () => ({ Authorization: `Bearer ${buyer.accessToken}` });

  async function publish(price = 200_000, stock = 20): Promise<string> {
    const created = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set(sellerHeaders())
      .send({ name: 'Nồi chiên', slug: uniqueSlug('p'), categoryId, skus: [{ optionValues: [], price, stock }] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(url(`/seller/products/${created.body.id}`))
      .set(sellerHeaders())
      .send({ status: 'ACTIVE' })
      .expect(200);

    return created.body.skus[0].id;
  }

  async function placeOrder(method: 'COD' | 'SEPAY_QR', price = 200_000, quantity = 1) {
    const skuId = await publish(price);
    await request(app.getHttpServer())
      .post(url('/storefront/cart/items'))
      .set(buyerAuth())
      .send({ skuId, quantity })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(url('/storefront/orders'))
      .set(buyerAuth())
      .send({ shopId, addressId, paymentMethod: method, idempotencyKey: randomUUID() })
      .expect(201);

    return { order: response.body.order as { id: string; total: number; itemsSubtotal: number }, skuId };
  }

  const payFor = async (orderId: string) => {
    const payment = await prisma.payment.findFirstOrThrow({ where: { orders: { some: { id: orderId } } } });
    const { body, headers } = signedWebhook(
      {
        id: transactionId++,
        content: `CT DEN ${payment.code}`,
        transferType: 'in',
        transferAmount: payment.amount,
      },
      WEBHOOK_SECRET,
    );
    await request(app.getHttpServer()).post(url('/webhooks/sepay')).set(headers).send(body).expect(200);
    return payment;
  };

  const advance = async (orderId: string, actions: string[]) => {
    for (const action of actions) {
      await request(app.getHttpServer())
        .post(url(`/seller/orders/${orderId}/${action}`))
        .set(sellerHeaders())
        .expect(200);
    }
  };

  const balance = async () => {
    const response = await request(app.getHttpServer())
      .get(url('/seller/finance/balance'))
      .set(sellerHeaders())
      .expect(200);
    return response.body as { pending: number; available: number };
  };

  const commissionOn = (itemsSubtotal: number) => Math.floor((itemsSubtotal * RATE_BPS) / 10_000);

  // ---------- the money path ----------

  describe('a transfer order', () => {
    it('holds the buyer’s money for the shop rather than paying it out', async () => {
      const before = await balance();
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);

      const after = await balance();
      expect(after.pending - before.pending).toBe(order.total);
      // Held, not spendable. That is what escrow means (ADR-015).
      expect(after.available).toBe(before.available);
    });

    it('does not release on delivery — the courier’s claim is not the buyer’s acceptance', async () => {
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      const held = await balance();

      await advance(order.id, ['confirm', 'ship', 'deliver']);

      expect(await balance()).toEqual(held);
    });

    it('releases to available, minus commission, when the buyer confirms', async () => {
      const before = await balance();
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);

      const completed = await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);

      expect(completed.body.status).toBe('COMPLETED');

      const commission = commissionOn(order.itemsSubtotal);
      const after = await balance();
      expect(after.pending).toBe(before.pending);
      expect(after.available - before.available).toBe(order.total - commission);
    });

    it('charges commission on the goods, not on the shipping fee', async () => {
      const { order } = await placeOrder('SEPAY_QR', 300_000);
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);
      const before = await balance();
      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);

      const credited = (await balance()).available - before.available;
      // The shop pays a courier out of the shipping fee; taking a cut of it would be
      // taking a cut of someone else's cost.
      expect(credited).toBe(order.total - commissionOn(order.itemsSubtotal));
      expect(order.total).toBeGreaterThan(order.itemsSubtotal);
    });

    it('cannot pay the shop twice, however many times completion is attempted', async () => {
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);

      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);
      const once = await balance();

      // Pressing it again, and the auto-release job reaching it, must both be no-ops.
      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);
      await release.autoRelease();

      expect(await balance()).toEqual(once);
    });

    it('releases automatically once the window after delivery has passed', async () => {
      const before = await balance();
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);

      // Most buyers never press the button; a shop's money cannot wait on that.
      await prisma.order.update({
        where: { id: order.id },
        data: { deliveredAt: new Date(Date.now() - 10 * 86_400_000) },
      });
      expect(await release.autoRelease()).toBeGreaterThan(0);

      const after = await balance();
      expect(after.available - before.available).toBe(order.total - commissionOn(order.itemsSubtotal));
    });
  });

  describe('a COD order', () => {
    it('never puts money in escrow, because none reaches the platform', async () => {
      const before = await balance();
      const { order } = await placeOrder('COD');

      expect(await balance()).toEqual(before);
      expect(order.total).toBeGreaterThan(0);
    });

    it('leaves the shop owing commission once it completes', async () => {
      const before = await balance();
      const { order } = await placeOrder('COD');
      await advance(order.id, ['confirm', 'ship', 'deliver']);
      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);

      const after = await balance();
      // The courier handed cash to the shop, so the fee is a debt — and a balance can
      // legitimately go negative (ADR-015).
      expect(after.available - before.available).toBe(-commissionOn(order.itemsSubtotal));
    });
  });

  // ---------- reversals ----------

  describe('refunds', () => {
    it('reverses the hold when a paid order is cancelled before release', async () => {
      const before = await balance();
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      expect((await balance()).pending).toBe(before.pending + order.total);

      await request(app.getHttpServer())
        .post(url(`/seller/orders/${order.id}/cancel`))
        .set(sellerHeaders())
        .send({ reason: 'Hết hàng' })
        .expect(200);

      expect(await balance()).toEqual(before);
    });

    it('takes it out of the available balance when the money was already released', async () => {
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);
      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);
      const credited = await balance();

      await prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } });
      await release.refund(order.id);

      const after = await balance();
      expect(after.available).toBe(credited.available - order.total);
    });

    it('never refunds the same order twice', async () => {
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      const held = await balance();

      await release.refund(order.id);
      const once = await balance();
      await release.refund(order.id);

      expect(await balance()).toEqual(once);
      expect(once.pending).toBe(held.pending - order.total);
    });
  });

  // ---------- the ledger itself ----------

  describe('the ledger', () => {
    it('explains every movement, and the balance is their sum', async () => {
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);
      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);

      const entries = await prisma.ledgerEntry.findMany({
        where: { orderId: order.id },
        orderBy: { id: 'asc' },
      });
      expect(entries.map((entry) => entry.reason)).toEqual([
        'ORDER_PAID',
        'ORDER_RELEASED',
        'ORDER_RELEASED',
        'COMMISSION',
      ]);

      // The shop's two accounts net to zero on a released order: everything that came
      // in went out again, to the shop and to the platform.
      const shopEntries = entries.filter((entry) => entry.account !== 'PLATFORM_REVENUE');
      const commission = commissionOn(order.itemsSubtotal);
      expect(shopEntries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(order.total - commission);
    });

    it('is append-only: a correction is its own entry, not an edit', async () => {
      const { order } = await placeOrder('SEPAY_QR');
      await payFor(order.id);
      const afterPaid = await prisma.ledgerEntry.count({ where: { orderId: order.id } });

      await release.refund(order.id);

      const entries = await prisma.ledgerEntry.findMany({ where: { orderId: order.id } });
      expect(entries.length).toBe(afterPaid + 1);
      // The original credit is untouched; the reversal sits next to it.
      expect(entries.some((entry) => entry.reason === 'ORDER_PAID' && entry.amount > 0)).toBe(true);
      expect(entries.some((entry) => entry.reason === 'ORDER_REFUNDED' && entry.amount < 0)).toBe(true);
    });

    it('shows the shop its own entries and nobody else’s', async () => {
      const outsider = await registerUser(app, 'SELLER');
      const otherShop = await createShop(app, outsider, uniqueSlug('other'));

      const response = await request(app.getHttpServer())
        .get(url('/seller/finance/ledger'))
        .set({ Authorization: `Bearer ${outsider.accessToken}`, 'x-shop-id': otherShop })
        .expect(200);

      expect(response.body.items).toHaveLength(0);
    });
  });

  // ---------- payouts ----------

  describe('payouts', () => {
    const setAccount = () =>
      request(app.getHttpServer())
        .put(url('/seller/finance/payout-account'))
        .set(sellerHeaders())
        .send({ bankCode: 'Vietcombank', accountNumber: '0010000000355', accountName: 'Nguyen Van A' })
        .expect(200);

    it('refuses before a bank account exists', async () => {
      const outsider = await registerUser(app, 'SELLER');
      const otherShop = await createShop(app, outsider, uniqueSlug('nobank'));

      await request(app.getHttpServer())
        .post(url('/seller/finance/payouts'))
        .set({ Authorization: `Bearer ${outsider.accessToken}`, 'x-shop-id': otherShop })
        .send({ amount: 100_000 })
        .expect(409);
    });

    it('refuses more than the available balance', async () => {
      await setAccount();
      const { available } = await balance();

      await request(app.getHttpServer())
        .post(url('/seller/finance/payouts'))
        .set(sellerHeaders())
        .send({ amount: available + 1_000_000 })
        .expect(409);
    });

    it('takes the money out of the available balance the moment it is requested', async () => {
      await setAccount();
      // Build up a releasable balance first.
      const { order } = await placeOrder('SEPAY_QR', 2_000_000);
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);
      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);

      const before = await balance();
      const response = await request(app.getHttpServer())
        .post(url('/seller/finance/payouts'))
        .set(sellerHeaders())
        .send({ amount: 500_000 })
        .expect(201);

      expect(response.body.status).toBe('REQUESTED');
      expect(response.body.accountNumberMasked).toBe('••••0355');
      expect((await balance()).available).toBe(before.available - 500_000);
    });

    it('cannot be requested twice for the same money', async () => {
      await setAccount();
      const { order } = await placeOrder('SEPAY_QR', 1_000_000);
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);
      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);

      const { available } = await balance();
      const send = () =>
        request(app.getHttpServer())
          .post(url('/seller/finance/payouts'))
          .set(sellerHeaders())
          .send({ amount: available });

      // The balance is read inside the same transaction that writes the debit, so the
      // second request sees the money already gone.
      const [a, b] = await Promise.all([send(), send()]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
      expect((await balance()).available).toBe(0);
    });

    it('snapshots the bank details, so editing the account does not rewrite history', async () => {
      await setAccount();
      const { order } = await placeOrder('SEPAY_QR', 1_500_000);
      await payFor(order.id);
      await advance(order.id, ['confirm', 'ship', 'deliver']);
      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/complete`))
        .set(buyerAuth())
        .expect(200);

      const payout = await request(app.getHttpServer())
        .post(url('/seller/finance/payouts'))
        .set(sellerHeaders())
        .send({ amount: 100_000 })
        .expect(201);

      await request(app.getHttpServer())
        .put(url('/seller/finance/payout-account'))
        .set(sellerHeaders())
        .send({ bankCode: 'ACB', accountNumber: '9999999999', accountName: 'Nguoi Khac' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(url('/seller/finance/payouts'))
        .set(sellerHeaders())
        .expect(200);

      const same = after.body.items.find((item: { id: string }) => item.id === payout.body.id);
      expect(same.accountNumberMasked).toBe('••••0355');
      expect(same.bankCode).toBe('Vietcombank');
    });

    it('refuses staff: a payout decides where money physically goes', async () => {
      const staff = await registerUser(app, 'SELLER');
      await request(app.getHttpServer())
        .post(url('/seller/shops/current/members'))
        .set(sellerHeaders())
        .send({ email: staff.email, role: 'STAFF' })
        .expect(201);

      await request(app.getHttpServer())
        .get(url('/seller/finance/balance'))
        .set({ Authorization: `Bearer ${staff.accessToken}`, 'x-shop-id': shopId })
        .expect(403);
    });
  });

  // ---------- expiry still works ----------

  describe('expiry', () => {
    it('cancels an unpaid transfer order and leaves the ledger untouched', async () => {
      const before = await balance();
      const { order, skuId } = await placeOrder('SEPAY_QR', 200_000, 2);

      const payment = await prisma.payment.findFirstOrThrow({
        where: { orders: { some: { id: order.id } } },
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expiry.sweep();

      const cancelled = await request(app.getHttpServer())
        .get(url(`/storefront/orders/${order.id}`))
        .set(buyerAuth())
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.cancelledBy).toBe('SYSTEM');

      // Nobody paid, so nothing moved.
      expect(await balance()).toEqual(before);
      const sku = await prisma.sku.findUniqueOrThrow({ where: { id: skuId } });
      expect(sku.stock).toBe(20);
    });
  });
});
