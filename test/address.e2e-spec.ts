import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser, url, type TestSession, createTestApp } from './helpers/auth-helpers.js';

describe('Address book (e2e)', () => {
  let app: NestExpressApplication;
  let buyer: TestSession;

  beforeAll(async () => {
    app = await createTestApp();
    buyer = await registerUser(app, 'STOREFRONT');
  });

  afterAll(async () => {
    await app.close();
  });

  const as = (session: TestSession, method: 'get' | 'post' | 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())[method](url(path)).set('Authorization', `Bearer ${session.accessToken}`);

  const validAddress = (overrides: Record<string, unknown> = {}) => ({
    recipientName: 'Nguyễn Minh Tài',
    phone: '0912345678',
    provinceName: 'TP. Hồ Chí Minh',
    wardName: 'Phường Võ Thị Sáu',
    streetLine: '128/4 Trần Quốc Thảo',
    ...overrides,
  });

  it('makes the first address the default, whatever the client asked for', async () => {
    const response = await as(buyer, 'post', '/storefront/addresses')
      .send(validAddress({ isDefault: false }))
      .expect(201);

    expect(response.body.isDefault).toBe(true);
    expect(response.body.formatted).toBe(
      '128/4 Trần Quốc Thảo, Phường Võ Thị Sáu, TP. Hồ Chí Minh',
    );
  });

  it('moves the default rather than ending up with two', async () => {
    const second = await as(buyer, 'post', '/storefront/addresses')
      .send(validAddress({ label: 'Văn phòng', isDefault: true }))
      .expect(201);

    const list = await as(buyer, 'get', '/storefront/addresses').expect(200);
    const defaults = list.body.filter((address: { isDefault: boolean }) => address.isDefault);

    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(second.body.id);
    expect(list.body[0].id).toBe(second.body.id); // default comes first
  });

  it('rejects a phone number that is not 10 digits starting with 0', async () => {
    const response = await as(buyer, 'post', '/storefront/addresses')
      .send(validAddress({ phone: '098765' }))
      .expect(400);

    expect(response.body.errors.join(' ')).toContain('phone');
  });

  it('refuses to leave the account with no default', async () => {
    const list = await as(buyer, 'get', '/storefront/addresses').expect(200);
    await as(buyer, 'patch', `/storefront/addresses/${list.body[0].id}`)
      .send({ isDefault: false })
      .expect(409);
  });

  it('promotes the next address when the default is deleted', async () => {
    const before = await as(buyer, 'get', '/storefront/addresses').expect(200);
    const previousDefault = before.body[0];

    await as(buyer, 'delete', `/storefront/addresses/${previousDefault.id}`).expect(204);

    const after = await as(buyer, 'get', '/storefront/addresses').expect(200);
    expect(after.body).toHaveLength(before.body.length - 1);
    expect(after.body[0].isDefault).toBe(true);
  });

  it('caps the book at ten addresses', async () => {
    const existing = await as(buyer, 'get', '/storefront/addresses').expect(200);

    for (let i = existing.body.length; i < 10; i += 1) {
      await as(buyer, 'post', '/storefront/addresses').send(validAddress()).expect(201);
    }

    await as(buyer, 'post', '/storefront/addresses').send(validAddress()).expect(409);
  });

  it('hides one shopper’s addresses from another', async () => {
    const stranger = await registerUser(app, 'STOREFRONT');
    const mine = await as(buyer, 'get', '/storefront/addresses').expect(200);

    const theirs = await as(stranger, 'get', '/storefront/addresses').expect(200);
    expect(theirs.body).toHaveLength(0);

    // 404 rather than 403: the id of someone else's address is not information we
    // confirm, even by the shape of the error.
    await as(stranger, 'patch', `/storefront/addresses/${mine.body[0].id}`)
      .send({ label: 'Của tôi' })
      .expect(404);
    await as(stranger, 'delete', `/storefront/addresses/${mine.body[0].id}`).expect(404);
  });

  it('rejects a seller token on a storefront endpoint', async () => {
    const seller = await registerUser(app, 'SELLER');
    await as(seller, 'get', '/storefront/addresses').expect(403);
  });
});
