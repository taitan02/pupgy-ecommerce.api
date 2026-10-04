import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { PaymentExpiryService } from '../src/modules/payments/services/payment-expiry.service.js';
import { PaymentService } from '../src/modules/payments/services/payment.service.js';
import { OrderService } from '../src/modules/orders/services/order.service.js';
import { PAYMENT_QUEUE } from '../src/modules/payments/services/payment.queue.js';
import { MAIL_QUEUE } from '../src/modules/notifications/notification.types.js';
import { createShop, createTestApp, registerUser, uniqueSlug, url, type TestSession } from './helpers/auth-helpers.js';
import { signedWebhook } from './helpers/sepay.js';

const WEBHOOK_SECRET = 'test-webhook-secret-not-a-real-one';

describe('SePay payments (e2e)', () => {
  let app: NestExpressApplication;
  let expiry: PaymentExpiryService;
  let prisma: PrismaService;

  let buyer: TestSession;
  let seller: TestSession;
  let shopId: string;
  let categoryId: string;
  let addressId: string;
  let webhookId: string;
  let transactionId = 1;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    buyer = await registerUser(app, 'STOREFRONT');
    seller = await registerUser(app, 'SELLER');
    shopId = await createShop(app, seller, uniqueSlug('pay'));

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

    // Built from the HTTP app's providers rather than by booting WorkerModule. The
    // expiry logic is what these tests exercise; starting a second Nest context just
    // to reach it also starts a BullMQ worker, whose delayed-job timers outlive the
    // suite and hang the process with every test green.
    expiry = new PaymentExpiryService(app.get(PaymentService), app.get(OrderService));
  });

  afterAll(async () => {
    // Every QR checkout leaves a delayed expiry job behind; the next spec file's
    // worker would otherwise pick them up and cancel orders it knows nothing about.
    for (const name of [PAYMENT_QUEUE, MAIL_QUEUE]) {
      await (app.get(getQueueToken(name)) as Queue).obliterate({ force: true });
    }
    await app.close();
  });

  beforeEach(async () => {
    await prisma.cartItem.deleteMany({ where: { userId: buyer.userId } });
  });

  // ---------- helpers ----------

  const seller_ = () => ({ Authorization: `Bearer ${seller.accessToken}`, 'x-shop-id': shopId });

  async function connectSepay(overrides: Record<string, unknown> = {}) {
    const response = await request(app.getHttpServer())
      .put(url('/seller/payment-account'))
      .set(seller_())
      .send({
        bankCode: 'Vietcombank',
        accountNumber: '0010000000355',
        accountName: 'Nguyen Van A',
        webhookSecret: WEBHOOK_SECRET,
        ...overrides,
      })
      .expect(200);

    webhookId = response.body.webhookUrl.split('/').pop();
    return response.body;
  }

  async function publish(stock = 10, price = 250_000): Promise<string> {
    const created = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set(seller_())
      .send({ name: 'Ấm đun nước', slug: uniqueSlug('p'), categoryId, skus: [{ optionValues: [], price, stock }] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(url(`/seller/products/${created.body.id}`))
      .set(seller_())
      .send({ status: 'ACTIVE' })
      .expect(200);

    return created.body.skus[0].id;
  }

  async function placeTransferOrder(quantity = 1) {
    const skuId = await publish();
    await request(app.getHttpServer())
      .post(url('/storefront/cart/items'))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ skuId, quantity })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post(url('/storefront/orders'))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ shopId, addressId, paymentMethod: 'SEPAY_QR', idempotencyKey: randomUUID() })
      .expect(201);

    return { order: response.body.order, skuId };
  }

  const postWebhook = (body: string, headers: Record<string, string>, id = webhookId) =>
    request(app.getHttpServer())
      .post(url(`/webhooks/sepay/${id}`))
      .set(headers)
      .send(body);

  const transfer = (overrides: Partial<Parameters<typeof signedWebhook>[0]> = {}) => ({
    id: transactionId++,
    content: 'PAYMENT',
    transferType: 'in' as const,
    transferAmount: 0,
    ...overrides,
  });

  const stockOf = async (skuId: string) =>
    (await prisma.sku.findUniqueOrThrow({ where: { id: skuId }, select: { stock: true } })).stock;

  // ---------- merchant setup ----------

  describe('connecting a SePay account', () => {
    it('gives the shop a webhook URL and never returns the secret', async () => {
      const account = await connectSepay();

      expect(account.webhookUrl).toContain('/api/v1/webhooks/sepay/');
      expect(account.hasSecret).toBe(true);
      expect(account.accountNumberMasked).toBe('••••0355');
      expect(JSON.stringify(account)).not.toContain(WEBHOOK_SECRET);
    });

    it('stores the secret encrypted, not in the clear', async () => {
      await connectSepay();

      const row = await prisma.shopPaymentAccount.findUniqueOrThrow({ where: { shopId } });
      expect(row.webhookSecretCipher).not.toContain(WEBHOOK_SECRET);
      // iv.tag.ciphertext — all three parts, or the column is useless rather than
      // subtly wrong.
      expect(row.webhookSecretCipher.split('.')).toHaveLength(3);
    });

    it('keeps the webhook URL stable when the bank details change', async () => {
      const before = await connectSepay();
      const after = await connectSepay({ accountName: 'Nguyen Van B', webhookSecret: undefined });

      // Changing it would silently break the URL already pasted into SePay, and the
      // first symptom would be payments that never arrive.
      expect(after.webhookUrl).toBe(before.webhookUrl);
      expect(after.accountName).toBe('NGUYEN VAN B');
    });

    it('refuses staff, because this decides where the money lands', async () => {
      const staff = await registerUser(app, 'SELLER');
      await request(app.getHttpServer())
        .post(url('/seller/shops/current/members'))
        .set(seller_())
        .send({ email: staff.email, role: 'STAFF' })
        .expect(201);

      await request(app.getHttpServer())
        .get(url('/seller/payment-account'))
        .set({ Authorization: `Bearer ${staff.accessToken}`, 'x-shop-id': shopId })
        .expect(403);
    });
  });

  // ---------- checkout ----------

  describe('checkout', () => {
    it('offers transfer only once the shop has connected an account', async () => {
      const outsider = await registerUser(app, 'SELLER');
      const otherShop = await createShop(app, outsider, uniqueSlug('nopay'));

      const skuId = await publish();
      await request(app.getHttpServer())
        .post(url('/storefront/cart/items'))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ skuId, quantity: 1 })
        .expect(201);

      await connectSepay();
      const quote = await request(app.getHttpServer())
        .post(url('/storefront/checkout/preview'))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ shopId })
        .expect(200);

      expect(quote.body.paymentMethods).toEqual(['COD', 'SEPAY_QR']);
      expect(otherShop).toBeTruthy();
    });

    it('refuses a transfer order for a shop that cannot receive one', async () => {
      const outsider = await registerUser(app, 'SELLER');
      const otherShop = await createShop(app, outsider, uniqueSlug('nopay'));

      const created = await request(app.getHttpServer())
        .post(url('/seller/products'))
        .set({ Authorization: `Bearer ${outsider.accessToken}`, 'x-shop-id': otherShop })
        .send({ name: 'Không nhận CK', slug: uniqueSlug('p'), categoryId, skus: [{ optionValues: [], price: 10_000, stock: 5 }] })
        .expect(201);
      await request(app.getHttpServer())
        .patch(url(`/seller/products/${created.body.id}`))
        .set({ Authorization: `Bearer ${outsider.accessToken}`, 'x-shop-id': otherShop })
        .send({ status: 'ACTIVE' })
        .expect(200);

      await request(app.getHttpServer())
        .post(url('/storefront/cart/items'))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ skuId: created.body.skus[0].id, quantity: 1 })
        .expect(201);

      await request(app.getHttpServer())
        .post(url('/storefront/orders'))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ shopId: otherShop, addressId, paymentMethod: 'SEPAY_QR', idempotencyKey: randomUUID() })
        .expect(409);
    });

    it('starts the order awaiting payment, with the stock already taken', async () => {
      await connectSepay();
      const { order, skuId } = await placeTransferOrder(2);

      expect(order.status).toBe('AWAITING_PAYMENT');
      expect(order.paymentStatus).toBe('UNPAID');
      // The hold on the stock *is* the reservation (ADR-014).
      expect(await stockOf(skuId)).toBe(8);
    });

    it('gives the buyer a QR, the bank details and the memo to use', async () => {
      await connectSepay();
      const { order } = await placeTransferOrder();

      const instructions = await request(app.getHttpServer())
        .get(url(`/storefront/orders/${order.id}/payment`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);

      expect(instructions.body.reference).toBe(order.code);
      expect(instructions.body.amount).toBe(order.total);
      expect(instructions.body.qrImageUrl).toContain('qr.sepay.vn/img');
      expect(instructions.body.qrImageUrl).toContain(`des=${order.code}`);
      expect(instructions.body.status).toBe('PENDING');
    });

    it('hides another buyer’s payment instructions', async () => {
      await connectSepay();
      const { order } = await placeTransferOrder();
      const stranger = await registerUser(app, 'STOREFRONT');

      // A reference is enough to pay somebody else's order by accident.
      await request(app.getHttpServer())
        .get(url(`/storefront/orders/${order.id}/payment`))
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(404);
    });
  });

  // ---------- the webhook ----------

  describe('webhook verification', () => {
    beforeEach(async () => {
      await connectSepay();
    });

    it('accepts a correctly signed transfer and marks the order paid', async () => {
      const { order } = await placeTransferOrder();
      const { body, headers } = signedWebhook(
        transfer({ content: `CHUYEN TIEN ${order.code}`, transferAmount: order.total }),
        WEBHOOK_SECRET,
      );

      const response = await postWebhook(body, headers).expect(200);
      expect(response.body).toEqual({ success: true });

      const paid = await request(app.getHttpServer())
        .get(url(`/storefront/orders/${order.id}`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      expect(paid.body.status).toBe('PENDING');
      expect(paid.body.paymentStatus).toBe('PAID');
    });

    it('rejects a body that changed after it was signed', async () => {
      const { order } = await placeTransferOrder();
      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total }),
        WEBHOOK_SECRET,
        { tamperBody: true },
      );

      await postWebhook(body, headers).expect(401);
    });

    it('rejects a signature made with the wrong secret', async () => {
      const { order } = await placeTransferOrder();
      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total }),
        'a-different-secret-entirely',
      );

      await postWebhook(body, headers).expect(401);
    });

    it('rejects a replay from outside the five-minute window', async () => {
      const { order } = await placeTransferOrder();
      // Perfectly valid signature, just old. Without the timestamp in the signed
      // string this body could be captured and replayed forever.
      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total }),
        WEBHOOK_SECRET,
        { timestamp: Math.floor(Date.now() / 1000) - 400 },
      );

      await postWebhook(body, headers).expect(401);
    });

    it('rejects a request with no signature at all', async () => {
      const { body } = signedWebhook(transfer(), WEBHOOK_SECRET);
      await postWebhook(body, { 'content-type': 'application/json' }).expect(401);
    });

    it('404s an unknown webhook id without hinting that signatures exist', async () => {
      const { body, headers } = signedWebhook(transfer(), WEBHOOK_SECRET);
      await postWebhook(body, headers, 'not-a-real-webhook-id').expect(404);
    });
  });

  // ---------- reconciliation ----------

  describe('reconciliation', () => {
    beforeEach(async () => {
      await connectSepay();
    });

    it('matches an order code the bank mangled on the way through', async () => {
      const { order } = await placeTransferOrder();
      // What a real bank delivers: no punctuation, extra words, upper case.
      const mangled = `TU NGUYEN VAN A CHUYEN TIEN ${order.code.replace('-', '')} TRAN`;

      const { body, headers } = signedWebhook(
        transfer({ content: mangled, transferAmount: order.total }),
        WEBHOOK_SECRET,
      );
      await postWebhook(body, headers).expect(200);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
      expect(payment.status).toBe('PAID');
    });

    it('refuses to settle a transfer for the wrong amount', async () => {
      const { order } = await placeTransferOrder();
      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total - 1000 }),
        WEBHOOK_SECRET,
      );

      // Answers 200 — retrying will not make the amount right — but nothing is paid.
      await postWebhook(body, headers).expect(200);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
      expect(payment.status).toBe('PENDING');
    });

    it('records a transfer that matches no order rather than dropping it', async () => {
      const { body, headers } = signedWebhook(
        transfer({ content: 'KHONG CO MA DON NAO', transferAmount: 123_000 }),
        WEBHOOK_SECRET,
      );
      await postWebhook(body, headers).expect(200);

      const event = await prisma.paymentEvent.findFirst({
        where: { shopId, paymentId: null },
        orderBy: { receivedAt: 'desc' },
      });
      // Somebody will eventually ask what happened to their money.
      expect(event).not.toBeNull();
    });

    it('ignores money leaving the account', async () => {
      const { order } = await placeTransferOrder();
      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total, transferType: 'out' }),
        WEBHOOK_SECRET,
      );
      await postWebhook(body, headers).expect(200);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
      // A refund must not mark the order it refers to as paid.
      expect(payment.status).toBe('PENDING');
    });

    it('pays once when SePay delivers the same transaction twice', async () => {
      const { order } = await placeTransferOrder();
      const payload = transfer({ content: order.code, transferAmount: order.total });

      const first = signedWebhook(payload, WEBHOOK_SECRET);
      await postWebhook(first.body, first.headers).expect(200);
      const second = signedWebhook(payload, WEBHOOK_SECRET);
      await postWebhook(second.body, second.headers).expect(200);

      const events = await prisma.paymentEvent.findMany({
        where: { shopId, providerTransactionId: String(payload.id) },
      });
      // Documented behaviour, not an edge case: up to seven deliveries over five hours.
      expect(events).toHaveLength(1);
    });

    it('survives two deliveries arriving at the same moment', async () => {
      const { order } = await placeTransferOrder();
      const payload = transfer({ content: order.code, transferAmount: order.total });

      const [a, b] = await Promise.all([
        (() => {
          const signed = signedWebhook(payload, WEBHOOK_SECRET);
          return postWebhook(signed.body, signed.headers);
        })(),
        (() => {
          const signed = signedWebhook(payload, WEBHOOK_SECRET);
          return postWebhook(signed.body, signed.headers);
        })(),
      ]);

      expect([a.status, b.status]).toEqual([200, 200]);
      const events = await prisma.paymentEvent.findMany({
        where: { shopId, providerTransactionId: String(payload.id) },
      });
      expect(events).toHaveLength(1);
    });

    it('does not let one shop’s webhook settle another shop’s order', async () => {
      const { order } = await placeTransferOrder();

      const outsider = await registerUser(app, 'SELLER');
      const otherShop = await createShop(app, outsider, uniqueSlug('other'));
      const theirAccount = await request(app.getHttpServer())
        .put(url('/seller/payment-account'))
        .set({ Authorization: `Bearer ${outsider.accessToken}`, 'x-shop-id': otherShop })
        .send({
          bankCode: 'ACB',
          accountNumber: '9999999999',
          accountName: 'Nguoi Khac',
          webhookSecret: 'another-shops-secret-value',
        })
        .expect(200);

      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total }),
        'another-shops-secret-value',
      );
      await postWebhook(body, headers, theirAccount.body.webhookUrl.split('/').pop()).expect(200);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
      // The candidate query is scoped to the shop the webhook belongs to.
      expect(payment.status).toBe('PENDING');
    });
  });

  // ---------- expiry ----------

  describe('expiry', () => {
    beforeEach(async () => {
      await connectSepay();
    });

    it('cancels an unpaid order and gives the stock back', async () => {
      const { order, skuId } = await placeTransferOrder(3);
      expect(await stockOf(skuId)).toBe(7);

      await prisma.payment.update({
        where: { orderId: order.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expiry.sweep();

      const cancelled = await request(app.getHttpServer())
        .get(url(`/storefront/orders/${order.id}`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);

      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.cancelledBy).toBe('SYSTEM');
      expect(await stockOf(skuId)).toBe(10);
    });

    it('leaves a paid order alone even if the sweeper reaches it', async () => {
      const { order } = await placeTransferOrder();
      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total }),
        WEBHOOK_SECRET,
      );
      await postWebhook(body, headers).expect(200);

      // Backdated after payment: the sweeper must lose this race, every time.
      await prisma.payment.update({
        where: { orderId: order.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expiry.sweep();

      const still = await request(app.getHttpServer())
        .get(url(`/storefront/orders/${order.id}`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      expect(still.body.status).toBe('PENDING');
    });

    it('is safe to run twice', async () => {
      const { order, skuId } = await placeTransferOrder(2);
      await prisma.payment.update({
        where: { orderId: order.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expiry.sweep();
      await expiry.sweep();

      // Restocking twice would hand the shop units it never had.
      expect(await stockOf(skuId)).toBe(10);
    });

    it('stops the buyer cancelling an order they have already paid for', async () => {
      const { order } = await placeTransferOrder();
      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total }),
        WEBHOOK_SECRET,
      );
      await postWebhook(body, headers).expect(200);

      // The money is already in the shop's bank account and the platform never touched
      // it, so "cancel" here would mean a refund only the shop can make (ADR-001).
      const paid = await request(app.getHttpServer())
        .get(url(`/storefront/orders/${order.id}`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .expect(200);
      expect(paid.body.allowedTransitions).not.toContain('CANCELLED');

      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/cancel`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({})
        .expect(409);
    });

    it('still lets the shop cancel a paid order, because only they can refund it', async () => {
      const { order } = await placeTransferOrder();
      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total }),
        WEBHOOK_SECRET,
      );
      await postWebhook(body, headers).expect(200);

      const cancelled = await request(app.getHttpServer())
        .post(url(`/seller/orders/${order.id}/cancel`))
        .set(seller_())
        .send({ reason: 'Hết hàng, đã hoàn tiền' })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
    });

    it('closes the payment window when the buyer cancels first', async () => {
      const { order } = await placeTransferOrder();

      await request(app.getHttpServer())
        .post(url(`/storefront/orders/${order.id}/cancel`))
        .set('Authorization', `Bearer ${buyer.accessToken}`)
        .send({ reason: 'Đổi ý' })
        .expect(200);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
      expect(payment.status).toBe('CANCELLED');
    });

    it('refuses to settle a transfer that arrives after expiry', async () => {
      const { order } = await placeTransferOrder();
      await prisma.payment.update({
        where: { orderId: order.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expiry.sweep();

      const { body, headers } = signedWebhook(
        transfer({ content: order.code, transferAmount: order.total }),
        WEBHOOK_SECRET,
      );
      await postWebhook(body, headers).expect(200);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
      // Real money arrived for a cancelled order. It is recorded, not silently applied
      // to an order whose stock has already gone back on the shelf.
      expect(payment.status).toBe('EXPIRED');
      const event = await prisma.paymentEvent.findFirst({
        where: { shopId },
        orderBy: { receivedAt: 'desc' },
      });
      expect(event).not.toBeNull();
    });
  });
});
