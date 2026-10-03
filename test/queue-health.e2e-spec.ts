import request from 'supertest';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAIL_QUEUE } from '../src/modules/notifications/notification.types.js';
import { createTestApp, url } from './helpers/auth-helpers.js';

/**
 * The detector for the one failure nothing else catches: jobs queued, nothing
 * consuming. No worker is started in this file — that is the condition under test.
 */
describe('Queue health (e2e)', () => {
  let app: NestExpressApplication;
  let queue: Queue;

  beforeAll(async () => {
    app = await createTestApp();
    queue = app.get(getQueueToken(MAIL_QUEUE));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  const read = () => request(app.getHttpServer()).get(url('/health/queues')).expect(200);

  it('reports ok and an empty queue when there is nothing to do', async () => {
    const response = await read();
    expect(response.body).toMatchObject({
      status: 'ok',
      mail: { waiting: 0, active: 0, failed: 0, oldestWaitingSeconds: null },
    });
  });

  it('counts queued work and how long it has been sitting', async () => {
    await queue.add('order-placed', { type: 'order-placed', orderId: 'x' }, { jobId: 'probe-1' });

    const response = await read();
    expect(response.body.mail.waiting).toBe(1);
    // Just enqueued, so still young — the age is present, which is what matters.
    expect(response.body.mail.oldestWaitingSeconds).toBeGreaterThanOrEqual(0);
    expect(response.body.status).toBe('ok');
  });

  it('says stalled once a job has waited longer than the threshold', async () => {
    // BullMQ lets the caller set the job's timestamp, which is how a two-minute
    // threshold gets tested without waiting two minutes. It is the same field the
    // endpoint reads.
    await queue.add(
      'order-placed',
      { type: 'order-placed', orderId: 'x' },
      { jobId: 'probe-2', timestamp: Date.now() - 600_000 },
    );

    const response = await read();
    expect(response.body.status).toBe('stalled');
    expect(response.body.mail.oldestWaitingSeconds).toBeGreaterThan(120);
  });

  it('does not report order volume', async () => {
    // The probes are unauthenticated, and `completed` would be a public counter of how
    // much business the platform does.
    const response = await read();
    expect(response.body.mail).not.toHaveProperty('completed');
  });

  it('keeps a dead worker out of readiness', async () => {
    // A stalled queue must not take the API out of rotation: serving the storefront is
    // still the right thing to do while email is behind.
    await queue.add('order-placed', { type: 'order-placed', orderId: 'x' }, { jobId: 'probe-3' });

    const ready = await request(app.getHttpServer()).get(url('/health/ready')).expect(200);
    expect(ready.body.status).toBe('ok');
  });
});
