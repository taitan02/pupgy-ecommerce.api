import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { logger } from '../../../infra/logger/logger.js';

export const PAYMENT_QUEUE = 'payments';

export type PaymentJob =
  | { type: 'expire-payment'; paymentId: string }
  /** Safety net for lost delayed jobs. */
  | { type: 'sweep-expired' }
  /** Releases escrow for orders delivered long enough ago that nobody is going to
   *  press "received" (ADR-015). */
  | { type: 'auto-release' };

export const SWEEP_JOB_ID = 'sweep-expired';
export const AUTO_RELEASE_JOB_ID = 'auto-release';

@Injectable()
export class PaymentQueue {
  constructor(@InjectQueue(PAYMENT_QUEUE) private readonly queue: Queue<PaymentJob>) {}

  /**
   * Failures are logged rather than thrown: a Redis hiccup must not fail a checkout
   * that has already taken stock — the sweeper catches what this misses, which is
   * exactly why the sweeper exists.
   */
  async scheduleExpiry(paymentId: string, delayMs: number): Promise<void> {
    try {
      await this.queue.add(
        'expire-payment',
        { type: 'expire-payment', paymentId },
        { jobId: `expire-${paymentId}`, delay: delayMs },
      );
    } catch (error) {
      logger.error({ err: error, paymentId }, 'could not schedule payment expiry');
    }
  }

  /** Registered at worker start. `upsertJobScheduler` is idempotent on the scheduler
   *  id, so restarting does not accumulate a new sweeper each time. */
  async ensureSchedulers(sweepEveryMs: number, releaseEveryMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_JOB_ID,
      { every: sweepEveryMs },
      { name: 'sweep-expired', data: { type: 'sweep-expired' } },
    );
    await this.queue.upsertJobScheduler(
      AUTO_RELEASE_JOB_ID,
      { every: releaseEveryMs },
      { name: 'auto-release', data: { type: 'auto-release' } },
    );
  }
}
