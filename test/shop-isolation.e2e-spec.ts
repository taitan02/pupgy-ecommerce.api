import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap/create-app.js';
import { createShop, registerUser, uniqueSlug, url, type TestSession } from './helpers/auth-helpers.js';

/**
 * The isolation suite. Every seller feature added from here on gets a case in a file
 * like this one: an authenticated user of Shop A must never reach Shop B's data
 * (ADR-006). These tests are the evidence behind that decision — without them, the
 * application-layer isolation is just an intention.
 */
describe('Shop isolation (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestSession;
  let bob: TestSession;
  let shopA: string;
  let shopB: string;

  beforeAll(async () => {
    app = await createApp();
    await app.init();

    alice = await registerUser(app, 'SELLER');
    bob = await registerUser(app, 'SELLER');
    shopA = await createShop(app, alice, uniqueSlug('shop-a'));
    shopB = await createShop(app, bob, uniqueSlug('shop-b'));
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a shop with the creator as OWNER', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/seller/shops'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(shopA);
    expect(response.body[0].role).toBe('OWNER');
  });

  it('refuses a seller endpoint without the shop header', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/seller/shops/current'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('CRITICAL: refuses a shop the caller is not a member of', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/seller/shops/current'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopB) // Alice pointing at Bob's shop
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    // The response must not reveal anything about the shop, not even that it exists.
    expect(JSON.stringify(response.body)).not.toContain('Shop');
  });

  it('CRITICAL: refuses to read another shop members list', async () => {
    await request(app.getHttpServer())
      .get(url('/seller/shops/current/members'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopB)
      .expect(403);
  });

  it('CRITICAL: refuses to modify another shop', async () => {
    await request(app.getHttpServer())
      .patch(url('/seller/shops/current'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopB)
      .send({ name: 'Hijacked' })
      .expect(403);

    // And Bob's shop is untouched.
    const bobsShop = await request(app.getHttpServer())
      .get(url('/seller/shops/current'))
      .set('Authorization', `Bearer ${bob.accessToken}`)
      .set('x-shop-id', shopB)
      .expect(200);

    expect(bobsShop.body.name).not.toBe('Hijacked');
  });

  it('refuses a non-existent shop id the same way as an unauthorised one', async () => {
    const response = await request(app.getHttpServer())
      .get(url('/seller/shops/current'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', '01a00000-0000-7000-8000-000000000000')
      .expect(403);

    // Same status and code as the unauthorised case: an attacker cannot use the
    // difference to enumerate which shop ids exist.
    expect(response.body.code).toBe('FORBIDDEN');
  });

  describe('roles', () => {
    let staff: TestSession;

    beforeAll(async () => {
      staff = await registerUser(app, 'SELLER');
      await request(app.getHttpServer())
        .post(url('/seller/shops/current/members'))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .send({ email: staff.email, role: 'STAFF' })
        .expect(201);
    });

    it('lets STAFF read the shop', async () => {
      await request(app.getHttpServer())
        .get(url('/seller/shops/current'))
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(200);
    });

    it('refuses STAFF the owner-only actions', async () => {
      await request(app.getHttpServer())
        .patch(url('/seller/shops/current'))
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .set('x-shop-id', shopA)
        .send({ name: 'Renamed by staff' })
        .expect(403);

      await request(app.getHttpServer())
        .post(url('/seller/shops/current/members'))
        .set('Authorization', `Bearer ${staff.accessToken}`)
        .set('x-shop-id', shopA)
        .send({ email: bob.email, role: 'STAFF' })
        .expect(403);
    });

    it('refuses to remove the last owner', async () => {
      const response = await request(app.getHttpServer())
        .delete(url(`/seller/shops/current/members/${alice.userId}`))
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .set('x-shop-id', shopA)
        .expect(409);

      expect(response.body.code).toBe('CONFLICT');
    });
  });

  describe('shop creation rules', () => {
    it('rejects a duplicate slug', async () => {
      const slug = uniqueSlug('dupe');
      await createShop(app, alice, slug);

      await request(app.getHttpServer())
        .post(url('/seller/shops'))
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ name: 'Copycat', slug })
        .expect(409);
    });

    it('rejects reserved slugs that would collide with platform routes', async () => {
      await request(app.getHttpServer())
        .post(url('/seller/shops'))
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ name: 'Checkout Shop', slug: 'checkout' })
        .expect(409);
    });

    it('rejects a slug with characters that do not belong in a URL', async () => {
      await request(app.getHttpServer())
        .post(url('/seller/shops'))
        .set('Authorization', `Bearer ${bob.accessToken}`)
        .send({ name: 'Bad', slug: 'Shop Của Tôi!' })
        .expect(400);
    });
  });

  it('keeps the shop list scoped to the caller', async () => {
    const aliceShops = await request(app.getHttpServer())
      .get(url('/seller/shops'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);

    const ids: string[] = aliceShops.body.map((shop: { id: string }) => shop.id);
    expect(ids).not.toContain(shopB);
  });
});
