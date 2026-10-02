import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisService } from '../src/infra/redis/redis.service.js';
import { registerUser, uniqueEmail, url, createTestApp } from './helpers/auth-helpers.js';

describe('Login rate limiting (e2e)', () => {
  let app: NestExpressApplication;
  let redis: RedisService;

  beforeAll(async () => {
    app = await createTestApp();

    redis = app.get(RedisService);
    // .env.test points at Redis database 1, so this cannot touch dev data.
    await redis.client.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  const attemptLogin = (email: string, password = 'wrong-password-xyz') =>
    request(app.getHttpServer()).post(url('/auth/login')).send({ email, password, audience: 'STOREFRONT' });

  it('blocks the sixth failed attempt on the same account', async () => {
    const email = uniqueEmail('bruteforce');

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await attemptLogin(email).expect(401);
    }

    const blocked = await attemptLogin(email).expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keeps blocking even when the password is finally correct', async () => {
    const session = await registerUser(app, 'STOREFRONT');

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await attemptLogin(session.email).expect(401);
    }

    // The limit is on attempts, not on failures: guessing the password on attempt six
    // must not be rewarded.
    await request(app.getHttpServer())
      .post(url('/auth/login'))
      .send({ email: session.email, password: 'test-password-123', audience: 'STOREFRONT' })
      .expect(429);
  });

  it('throttles per account, so one victim does not lock out everyone else', async () => {
    const victim = uniqueEmail('victim');
    const bystander = await registerUser(app, 'STOREFRONT');

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await attemptLogin(victim);
    }

    await request(app.getHttpServer())
      .post(url('/auth/login'))
      .send({ email: bystander.email, password: 'test-password-123', audience: 'STOREFRONT' })
      .expect(200);
  });

  it('allows traffic through when Redis is unreachable', async () => {
    const email = uniqueEmail('redis-down');
    const original = redis.client.incr.bind(redis.client);
    redis.client.incr = (() => Promise.reject(new Error('connection refused'))) as typeof original;

    try {
      // Fail open: a Redis outage must not become an authentication outage.
      for (let attempt = 1; attempt <= 7; attempt += 1) {
        await attemptLogin(email).expect(401);
      }
    } finally {
      redis.client.incr = original;
    }
  });
});
