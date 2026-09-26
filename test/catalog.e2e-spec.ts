import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, API_PREFIX } from '../src/bootstrap/create-app.js';

/**
 * Runs against a real database (see TEST_DATABASE_URL). The walking skeleton is only
 * proven if the data actually comes out of Postgres — a mocked test here would pass
 * on a system that cannot connect to anything.
 */
describe('Catalog (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live responds without touching dependencies', async () => {
    const response = await request(app.getHttpServer()).get(`/${API_PREFIX}/health/live`).expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready reports the database check', async () => {
    const response = await request(app.getHttpServer()).get(`/${API_PREFIX}/health/ready`).expect(200);
    expect(response.body.checks.database).toBe('ok');
  });

  it('GET /storefront/categories returns a seeded tree with children nested', async () => {
    const response = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/storefront/categories`)
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);

    const root = response.body[0];
    expect(root).toHaveProperty('slug');
    expect(root).toHaveProperty('children');
    // Roots are returned as roots, never duplicated inside another node's children.
    const allChildSlugs = response.body.flatMap((node: { children: { slug: string }[] }) =>
      node.children.map((child) => child.slug),
    );
    expect(allChildSlugs).not.toContain(root.slug);
  });

  it('returns RFC 9457 problem+json with a requestId on unknown routes', async () => {
    const response = await request(app.getHttpServer()).get(`/${API_PREFIX}/does-not-exist`).expect(404);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('NOT_FOUND');
    expect(response.body.requestId).toBeTruthy();
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });
});
