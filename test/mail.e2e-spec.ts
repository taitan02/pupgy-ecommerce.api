import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkerModule } from '../src/worker.module.js';
import { MailProcessor } from '../src/modules/notifications/mail.processor.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { MAIL_QUEUE, type MailJob } from '../src/modules/notifications/notification.types.js';
import { createShop, registerUser, uniqueSlug, url, type TestSession, createTestApp } from './helpers/auth-helpers.js';
import { addressedTo, clearMailbox, messageHtml, waitForMessage } from './helpers/mailpit.js';

/**
 * These run the real processor against the real SMTP server (Mailpit), then read the
 * message back out of it. Asserting that a template function returned a string proves
 * nothing about whether an email can leave the process.
 *
 * Booting WorkerModule here also starts the BullMQ worker, so jobs the API enqueues are
 * consumed for real — which is what `delivers through the queue` exercises. The other
 * cases hand a job to the processor directly, so that a failure is a mail failure and
 * never a queue-timing one.
 */
describe('Transactional email (e2e)', () => {
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let processor: MailProcessor;
  let prisma: PrismaService;

  let buyer: TestSession;
  let seller: TestSession;
  let shopId: string;
  let categoryId: string;
  let addressId: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Every other spec file enqueues mail jobs that nothing consumes — no worker runs
    // in those processes. Starting this file's worker on top of that backlog means the
    // job this file cares about queues behind a hundred others, and the test times out
    // waiting for an email that is merely late. Start from an empty queue.
    await (app.get(getQueueToken(MAIL_QUEUE)) as Queue).obliterate({ force: true });

    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    processor = worker.get(MailProcessor);
    prisma = app.get(PrismaService);

    buyer = await registerUser(app, 'STOREFRONT');
    seller = await registerUser(app, 'SELLER');
    shopId = await createShop(app, seller, uniqueSlug('mail'));

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
    // And drain on the way out, so a job left behind here is not delivered by the next
    // spec file's worker to someone who is not expecting it.
    await (app.get(getQueueToken(MAIL_QUEUE)) as Queue).obliterate({ force: true });
    await worker.close();
    await app.close();
  });

  beforeEach(async () => {
    await clearMailbox();
    await prisma.cartItem.deleteMany({ where: { userId: buyer.userId } });
  });

  async function placeOrder(productName = 'Bình giữ nhiệt'): Promise<string> {
    const created = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({
        name: productName,
        slug: uniqueSlug('p'),
        categoryId,
        skus: [{ optionValues: [], price: 350_000, stock: 10 }],
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(url(`/seller/products/${created.body.id}`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await request(app.getHttpServer())
      .post(url('/storefront/cart/items'))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ skuId: created.body.skus[0].id, quantity: 2 })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post(url('/storefront/orders'))
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({ shopId, addressId, paymentMethod: 'COD', idempotencyKey: randomUUID() })
      .expect(201);

    return order.body.order.id;
  }

  /** The processor takes a BullMQ Job; only `data` is read, so a stub is honest here. */
  const run = (data: MailJob) => processor.process({ data } as never);

  it('sends the buyer a confirmation with the order code and the lines', async () => {
    const orderId = await placeOrder();
    await run({ type: 'order-placed', orderId });

    const message = await waitForMessage((m) => addressedTo(buyer.email)(m) && m.Subject.startsWith('Đã đặt đơn'));

    const html = await messageHtml(message.ID);
    expect(html).toContain('Bình giữ nhiệt');
    expect(html).toContain('700.000'); // 350.000 x 2, before shipping
    expect(html).toContain(`/account/orders/${orderId}`);
  });

  it('tells the shop owner, at their own address and with their own link', async () => {
    const orderId = await placeOrder();
    await run({ type: 'order-received', orderId });

    const message = await waitForMessage((m) => addressedTo(seller.email)(m) && m.Subject.startsWith('Đơn hàng mới'));
    expect(await messageHtml(message.ID)).toContain(`/orders/${orderId}`);
  });

  it('escapes a product name that contains markup', async () => {
    // A seller controls this string and an email is a document somebody else's client
    // renders. Same rule as a web page.
    const orderId = await placeOrder('<script>alert(1)</script>Áo');
    await run({ type: 'order-placed', orderId });

    const message = await waitForMessage((m) => addressedTo(buyer.email)(m) && m.Subject.startsWith('Đã đặt đơn'));
    const html = await messageHtml(message.ID);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('delivers through the queue, with nobody calling the processor', async () => {
    const orderId = await placeOrder();

    // placeOrder already enqueued order-placed and order-received; confirming adds a
    // third. Nothing in this test touches the processor.
    await request(app.getHttpServer())
      .post(url(`/seller/orders/${orderId}/confirm`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .expect(200);

    await waitForMessage(
      (m) => addressedTo(buyer.email)(m) && m.Subject.includes('đã được shop xác nhận'),
    );
  });

  it('skips a status email when the order has already moved on', async () => {
    const orderId = await placeOrder();
    await request(app.getHttpServer())
      .post(url(`/seller/orders/${orderId}/confirm`))
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .set('x-shop-id', shopId)
      .expect(200);

    // Let the queue deliver the real CONFIRMED email first, otherwise clearing the
    // mailbox races with it and this test fails for the wrong reason.
    await waitForMessage(
      (m) => addressedTo(buyer.email)(m) && m.Subject.includes('đã được shop xác nhận'),
    );
    await clearMailbox();

    // Queued while PENDING, running after the shop confirmed: sending it now would
    // tell the buyer something that stopped being true (ADR-013).
    await run({ type: 'order-status', orderId, status: 'PENDING' });

    await expect(waitForMessage(() => true, 700)).rejects.toThrow(/No matching message/);
  });

  it('sends the delivered email only when the order really is delivered', async () => {
    const orderId = await placeOrder();
    const seller_ = { Authorization: `Bearer ${seller.accessToken}`, 'x-shop-id': shopId };
    for (const action of ['confirm', 'ship', 'deliver']) {
      await request(app.getHttpServer())
        .post(url(`/seller/orders/${orderId}/${action}`))
        .set(seller_)
        .expect(200);
    }
    await clearMailbox();

    await run({ type: 'order-status', orderId, status: 'DELIVERED' });
    await waitForMessage(
      (m) => addressedTo(buyer.email)(m) && m.Subject.includes('đã giao thành công'),
    );
  });

  it('treats an order that no longer exists as nothing to send, not as a failure', async () => {
    await expect(run({ type: 'order-placed', orderId: '01a0ee0f-0000-7000-8000-000000000000' })).resolves
      .toBeUndefined();
  });
});
