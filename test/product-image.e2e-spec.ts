import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createShop, registerUser, uniqueSlug, url, type TestSession, createTestApp } from './helpers/auth-helpers.js';

/**
 * Runs against the real MinIO from docker-compose, using the same S3 API that
 * Cloudflare R2 serves in production. Mocking the store here would test nothing:
 * presigning and the post-upload verification are the whole feature.
 */
describe('Product images (e2e)', () => {
  let app: NestExpressApplication;
  let alice: TestSession;
  let bob: TestSession;
  let shopA: string;
  let shopB: string;
  let productId: string;

  beforeAll(async () => {
    app = await createTestApp();

    alice = await registerUser(app, 'SELLER');
    bob = await registerUser(app, 'SELLER');
    shopA = await createShop(app, alice, uniqueSlug('img-a'));
    shopB = await createShop(app, bob, uniqueSlug('img-b'));

    const categories = await request(app.getHttpServer()).get(url('/storefront/categories')).expect(200);
    const categoryId = categories.body[0].children[0].id;

    const product = await request(app.getHttpServer())
      .post(url('/seller/products'))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopA)
      .send({
        name: 'Sản phẩm có ảnh',
        slug: uniqueSlug('co-anh'),
        categoryId,
        skus: [{ optionValues: [], price: 100_000, stock: 1 }],
      })
      .expect(201);

    productId = product.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const askUploadUrl = (session: TestSession, shopId: string, contentType = 'image/png') =>
    request(app.getHttpServer())
      .post(url(`/seller/products/${productId}/images/upload-url`))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('x-shop-id', shopId)
      .send({ contentType });

  const registerImage = (session: TestSession, shopId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(url(`/seller/products/${productId}/images`))
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('x-shop-id', shopId)
      .send(body);

  /** A one-pixel PNG, padded to whatever size the test needs. */
  const pngBytes = (totalBytes = 0) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    return totalBytes > png.length ? Buffer.concat([png, Buffer.alloc(totalBytes - png.length)]) : png;
  };

  const uploadTo = (uploadUrl: string, body: Buffer, contentType = 'image/png') =>
    fetch(uploadUrl, { method: 'PUT', body: new Uint8Array(body), headers: { 'content-type': contentType } });

  it('issues a presigned URL scoped to the caller shop and product', async () => {
    const response = await askUploadUrl(alice, shopA).expect(200);

    expect(response.body.key).toContain(`shops/${shopA}/products/${productId}/`);
    expect(response.body.uploadUrl).toContain('X-Amz-Signature');
    expect(response.body.expiresInSeconds).toBe(300);
  });

  it('uploads to storage and attaches the image to the product', async () => {
    const { body } = await askUploadUrl(alice, shopA).expect(200);

    const upload = await uploadTo(body.uploadUrl, pngBytes());
    expect(upload.ok).toBe(true);

    const registered = await registerImage(alice, shopA, { key: body.key, alt: 'Ảnh sản phẩm' }).expect(201);
    expect(registered.body.url).toContain(body.key);
    expect(registered.body.alt).toBe('Ảnh sản phẩm');

    const product = await request(app.getHttpServer())
      .get(url(`/seller/products/${productId}`))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopA)
      .expect(200);

    expect(product.body.images).toHaveLength(1);
  });

  it('rejects a file larger than the limit and deletes it from storage', async () => {
    const { body } = await askUploadUrl(alice, shopA).expect(200);

    // The presigned URL cannot enforce a size, so this upload succeeds — which is
    // exactly why registration verifies the object rather than trusting the request.
    const upload = await uploadTo(body.uploadUrl, pngBytes(6 * 1024 * 1024));
    expect(upload.ok).toBe(true);

    await registerImage(alice, shopA, { key: body.key }).expect(409);

    // Registering again must fail because the oversized object was removed.
    await registerImage(alice, shopA, { key: body.key }).expect(404);
  });

  it('refuses a key that was never uploaded', async () => {
    await registerImage(alice, shopA, {
      key: `shops/${shopA}/products/${productId}/00000000-0000-7000-8000-000000000000.png`,
    }).expect(404);
  });

  it("CRITICAL: refuses a key pointing into another shop's prefix", async () => {
    await registerImage(alice, shopA, {
      key: `shops/${shopB}/products/${productId}/00000000-0000-7000-8000-000000000000.png`,
    }).expect(403);
  });

  it("CRITICAL: another shop cannot ask for an upload URL for this product", async () => {
    await askUploadUrl(bob, shopB).expect(404);
  });

  it('rejects an unsupported content type before signing anything', async () => {
    await askUploadUrl(alice, shopA, 'application/pdf').expect(400);
  });

  it('deletes an image and removes it from the product', async () => {
    const { body } = await askUploadUrl(alice, shopA).expect(200);
    await uploadTo(body.uploadUrl, pngBytes());
    const image = await registerImage(alice, shopA, { key: body.key }).expect(201);

    await request(app.getHttpServer())
      .delete(url(`/seller/products/${productId}/images/${image.body.id}`))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopA)
      .expect(204);

    const product = await request(app.getHttpServer())
      .get(url(`/seller/products/${productId}`))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopA)
      .expect(200);

    const ids = product.body.images.map((img: { id: string }) => img.id);
    expect(ids).not.toContain(image.body.id);
  });

  it('exposes the cover image in the public listing once published', async () => {
    await request(app.getHttpServer())
      .patch(url(`/seller/products/${productId}`))
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .set('x-shop-id', shopA)
      .send({ status: 'ACTIVE' })
      .expect(200);

    const listing = await request(app.getHttpServer())
      .get(url('/storefront/products'))
      .query({ limit: 100 })
      .expect(200);

    const item = listing.body.items.find((entry: { id: string }) => entry.id === productId);
    expect(item.coverImageUrl).toContain(`shops/${shopA}/products/${productId}/`);
  });
});
