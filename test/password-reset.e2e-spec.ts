import request from 'supertest';
import { createHash } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkerModule } from '../src/worker.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { PAYMENT_QUEUE } from '../src/modules/payments/services/payment.queue.js';
import { MAIL_QUEUE } from '../src/modules/notifications/notification.types.js';
import { registerUser, uniqueEmail, url, type TestSession, createTestApp } from './helpers/auth-helpers.js';
import { addressedTo, clearMailbox, messageHtml, waitForMessage } from './helpers/mailpit.js';

const NEW_PASSWORD = 'a-completely-new-password';

describe('Password reset (e2e)', () => {
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let prisma: PrismaService;
  let user: TestSession;

  beforeAll(async () => {
    app = await createTestApp();
    await clearMailbox();
    // Booting the worker means the reset email is really queued, rendered and sent.
    // Every other spec file enqueues mail jobs that nothing consumes — no worker runs
    // in those processes. Starting this file's worker on top of that backlog means the
    // job this file cares about queues behind a hundred others, and the test times out
    // waiting for an email that is merely late. Start from an empty queue.
    for (const name of [MAIL_QUEUE, PAYMENT_QUEUE]) {
      await (app.get(getQueueToken(name)) as Queue).obliterate({ force: true });
    }

    worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Order matters: stop the processors first, then empty the queues, then close the
    // app. Obliterating a queue a worker is still attached to leaves timers running
    // and the process never exits — the suite hangs after the last assertion with
    // every test green.
    await worker.close();
    for (const name of [MAIL_QUEUE, PAYMENT_QUEUE]) {
      await (app.get(getQueueToken(name)) as Queue).obliterate({ force: true });
    }
    await app.close();
  });

  // The mailbox is cleared once, not per test. Delivery is asynchronous, so clearing
  // between tests races with mail still on its way and makes failures look like
  // missing emails. Every test registers its own user instead, and matches on that
  // address.
  beforeEach(async () => {
    user = await registerUser(app, 'STOREFRONT');
  });

  /** The token from a later email than `previous`. Both are addressed to the same
   *  person, so identity alone cannot tell them apart. */
  async function newestTokenFor(email: string, previous: string): Promise<string> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const token = await tokenFromEmail(email);
      if (token !== previous) return token;
      if (Date.now() > deadline) throw new Error('Second reset email never arrived');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const forgot = (email: string, audience: 'STOREFRONT' | 'SELLER' = 'STOREFRONT') =>
    request(app.getHttpServer()).post(url('/auth/forgot-password')).send({ email, audience });

  const reset = (token: string, password = NEW_PASSWORD) =>
    request(app.getHttpServer()).post(url('/auth/reset-password')).send({ token, password });

  /** The token only exists in the email; the database has its hash. Pulling it out of
   *  the link is exactly what a person does. */
  async function tokenFromEmail(email = user.email): Promise<string> {
    const message = await waitForMessage(addressedTo(email));
    const html = await messageHtml(message.ID);
    const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(html);
    if (!match) throw new Error('No reset link in the email');
    return decodeURIComponent(match[1]!);
  }

  describe('requesting a link', () => {
    it('answers the same for an address that has no account', async () => {
      // Any difference here — status, body, or a measurably different delay — turns
      // this endpoint into a way to find out who has an account.
      const known = await forgot(user.email).expect(202);
      const unknown = await forgot(uniqueEmail('nobody')).expect(202);

      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
    });

    it('creates no token for an address that has no account', async () => {
      const nobody = uniqueEmail('nobody');
      await forgot(nobody).expect(202);
      await expect(waitForMessage(addressedTo(nobody), 1_500)).rejects.toThrow(/No matching/);
    });

    it('leaves no copy of the token in Redis once the email is sent', async () => {
      // The database only ever sees the SHA-256, but the job payload must carry the
      // plaintext — the email needs it. The default retention would then leave a live
      // token readable in the queue for a day, which undoes the point of hashing it.
      await forgot(user.email).expect(202);
      await tokenFromEmail();

      const queue = app.get(getQueueToken(MAIL_QUEUE)) as Queue;
      const lingering = await queue.getJobs(['completed', 'waiting', 'active', 'delayed']);
      expect(lingering.filter((job) => job.data.type === 'password-reset')).toHaveLength(0);
    });

    it('stores only the hash of the token', async () => {
      await forgot(user.email).expect(202);
      const token = await tokenFromEmail();

      const row = await prisma.passwordResetToken.findFirst({ where: { userId: user.userId } });
      expect(row).not.toBeNull();
      expect(row!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      // The plaintext must not be recoverable from the row.
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('sends the seller link to Seller Center and the storefront link to the storefront', async () => {
      await forgot(user.email, 'SELLER').expect(202);
      const message = await waitForMessage(addressedTo(user.email));
      expect(message.Subject).toBe('Đặt lại mật khẩu Pupgy');
      expect(await messageHtml(message.ID)).toContain('localhost:3002/reset-password');
    });

    it('invalidates an earlier link when a new one is requested', async () => {
      await forgot(user.email).expect(202);
      const first = await tokenFromEmail();

      await forgot(user.email).expect(202);
      // Two emails now exist for this address; the newest one carries the live link.
      const second = await newestTokenFor(user.email, first);
      expect(second).not.toBe(first);

      // The link in the older email must be dead — otherwise an email forwarded or
      // left in a shared inbox stays usable forever.
      await reset(first).expect(409);
      await reset(second).expect(204);
    });
  });

  describe('redeeming a link', () => {
    it('sets the new password and refuses the old one', async () => {
      await forgot(user.email).expect(202);
      await reset(await tokenFromEmail()).expect(204);

      await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: user.email, password: 'test-password-123', audience: 'STOREFRONT' })
        .expect(401);

      await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: user.email, password: NEW_PASSWORD, audience: 'STOREFRONT' })
        .expect(200);
    });

    it('revokes the sessions that existed before the reset', async () => {
      // The usual reason to reset is believing somebody else has the password. Leaving
      // their refresh token alive would make the reset theatre (ADR-007).
      await forgot(user.email).expect(202);
      await reset(await tokenFromEmail()).expect(204);

      await request(app.getHttpServer())
        .post(url('/auth/refresh'))
        .set('Cookie', user.refreshCookie)
        .send({ audience: 'STOREFRONT' })
        .expect(401);
    });

    it('refuses a token that has already been used', async () => {
      await forgot(user.email).expect(202);
      const token = await tokenFromEmail();

      await reset(token).expect(204);
      await reset(token, 'yet-another-password').expect(409);
    });

    it('refuses an expired token', async () => {
      await forgot(user.email).expect(202);
      const token = await tokenFromEmail();

      await prisma.passwordResetToken.updateMany({
        where: { userId: user.userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await reset(token).expect(409);
    });

    it('refuses a made-up token', async () => {
      await reset('this-token-was-never-issued-at-all').expect(409);
    });

    it('rejects a new password that is too short', async () => {
      await forgot(user.email).expect(202);
      await reset(await tokenFromEmail(), 'short').expect(400);
    });
  });
});
