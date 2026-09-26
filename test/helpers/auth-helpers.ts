import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX } from '../../src/bootstrap/create-app.js';

export const url = (path: string) => `/${API_PREFIX}${path}`;

export interface TestSession {
  userId: string;
  email: string;
  accessToken: string;
  refreshCookie: string;
}

/** Every test user gets a unique email so tests never collide on the unique index. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

export async function registerUser(
  app: NestExpressApplication,
  audience: 'STOREFRONT' | 'SELLER',
  email = uniqueEmail('user'),
): Promise<TestSession> {
  const response = await request(app.getHttpServer())
    .post(url('/auth/register'))
    .send({ email, password: 'test-password-123', audience })
    .expect(201);

  return {
    userId: response.body.user.id,
    email,
    accessToken: response.body.accessToken,
    refreshCookie: extractRefreshCookie(response.headers['set-cookie']),
  };
}

export async function createShop(
  app: NestExpressApplication,
  session: TestSession,
  slug: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post(url('/seller/shops'))
    .set('Authorization', `Bearer ${session.accessToken}`)
    .send({ name: `Shop ${slug}`, slug })
    .expect(201);

  return response.body.id;
}

export function extractRefreshCookie(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies.find((value) => value.startsWith('sf_rt=') || value.startsWith('sc_rt='));
  if (!cookie) throw new Error('No refresh cookie in response');
  return cookie.split(';')[0]!;
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
