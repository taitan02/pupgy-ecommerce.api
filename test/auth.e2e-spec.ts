import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractRefreshCookie, registerUser, uniqueEmail, url, createTestApp } from './helpers/auth-helpers.js';

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('registration and login', () => {
    it('registers a user, returns an access token and sets an httpOnly refresh cookie', async () => {
      const email = uniqueEmail('register');
      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email, password: 'test-password-123', audience: 'STOREFRONT' })
        .expect(201);

      expect(response.body.accessToken).toBeTruthy();
      expect(response.body.user.email).toBe(email);
      // The password must never come back in any shape.
      expect(JSON.stringify(response.body)).not.toContain('test-password-123');

      const cookie = (response.headers['set-cookie'] as unknown as string[])[0]!;
      expect(cookie).toContain('sf_rt=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/api/v1/auth/refresh');
    });

    it('rejects a duplicate email', async () => {
      const email = uniqueEmail('dup');
      await registerUser(app, 'STOREFRONT', email);

      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email, password: 'test-password-123', audience: 'STOREFRONT' })
        .expect(409);

      expect(response.body.code).toBe('CONFLICT');
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      const session = await registerUser(app, 'STOREFRONT');

      const wrongPassword = await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: session.email, password: 'wrong-password-99', audience: 'STOREFRONT' })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post(url('/auth/login'))
        .send({ email: uniqueEmail('ghost'), password: 'test-password-123', audience: 'STOREFRONT' })
        .expect(401);

      // Identical responses: login must not reveal which emails exist.
      expect(wrongPassword.body.detail).toBe(unknownEmail.body.detail);
    });

    it('rejects a password shorter than the minimum', async () => {
      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({ email: uniqueEmail('short'), password: 'short', audience: 'STOREFRONT' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('strips unknown properties instead of trusting them', async () => {
      const response = await request(app.getHttpServer())
        .post(url('/auth/register'))
        .send({
          email: uniqueEmail('extra'),
          password: 'test-password-123',
          audience: 'STOREFRONT',
          status: 'SUSPENDED',
          role: 'ADMIN',
        })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('access token', () => {
    it('rejects requests with no token', async () => {
      await request(app.getHttpServer()).get(url('/auth/me')).expect(401);
    });

    it('rejects a tampered token', async () => {
      const session = await registerUser(app, 'STOREFRONT');
      await request(app.getHttpServer())
        .get(url('/auth/me'))
        .set('Authorization', `Bearer ${session.accessToken}x`)
        .expect(401);
    });

    it('accepts a valid token', async () => {
      const session = await registerUser(app, 'STOREFRONT');
      const response = await request(app.getHttpServer())
        .get(url('/auth/me'))
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      expect(response.body.id).toBe(session.userId);
    });

    it('refuses a STOREFRONT token on a SELLER endpoint (ADR-007)', async () => {
      const session = await registerUser(app, 'STOREFRONT');
      const response = await request(app.getHttpServer())
        .get(url('/seller/shops'))
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('refresh rotation', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      const session = await registerUser(app, 'STOREFRONT');

      const response = await request(app.getHttpServer())
        .post(url('/auth/refresh'))
        .set('Cookie', session.refreshCookie)
        .send({ audience: 'STOREFRONT' })
        .expect(200);

      expect(response.body.accessToken).toBeTruthy();
      const rotated = extractRefreshCookie(response.headers['set-cookie']);
      expect(rotated).not.toBe(session.refreshCookie);
    });

    it('revokes the whole family when a used token is replayed', async () => {
      const session = await registerUser(app, 'STOREFRONT');

      const first = await request(app.getHttpServer())
        .post(url('/auth/refresh'))
        .set('Cookie', session.refreshCookie)
        .send({ audience: 'STOREFRONT' })
        .expect(200);

      const rotatedCookie = extractRefreshCookie(first.headers['set-cookie']);

      // Replaying the original token: the signal of a stolen credential.
      await request(app.getHttpServer())
        .post(url('/auth/refresh'))
        .set('Cookie', session.refreshCookie)
        .send({ audience: 'STOREFRONT' })
        .expect(401);

      // The legitimate descendant is revoked too — that is the point of family
      // revocation: we cannot tell victim from attacker, so the session ends.
      await request(app.getHttpServer())
        .post(url('/auth/refresh'))
        .set('Cookie', rotatedCookie)
        .send({ audience: 'STOREFRONT' })
        .expect(401);
    });

    it('refuses to refresh after logout', async () => {
      const session = await registerUser(app, 'STOREFRONT');

      await request(app.getHttpServer())
        .post(url('/auth/logout'))
        .set('Cookie', session.refreshCookie)
        .send({ audience: 'STOREFRONT' })
        .expect(204);

      await request(app.getHttpServer())
        .post(url('/auth/refresh'))
        .set('Cookie', session.refreshCookie)
        .send({ audience: 'STOREFRONT' })
        .expect(401);
    });

    it('does not accept a seller cookie as a storefront refresh token', async () => {
      const seller = await registerUser(app, 'SELLER');

      await request(app.getHttpServer())
        .post(url('/auth/refresh'))
        .set('Cookie', seller.refreshCookie) // sc_rt, while we ask for STOREFRONT
        .send({ audience: 'STOREFRONT' })
        .expect(401);
    });
  });

});
