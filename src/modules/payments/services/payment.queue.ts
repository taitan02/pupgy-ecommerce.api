import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { logger } from '../../../infra/logger/logger.js';

export const PAYMENT_QUEUE = 'payments';

export type PaymentJob =
  | { type: 'expire-payment'; orderId: string }
  /** The safety net. Repeatable, and it finds anything a delayed job missed. */
  | { type: 'sweep-expired' };

export const SWEEP_JOB_ID = 'sweep-expired';

@Injectable()
export class PaymentQueue {
  constructor(@InjectQueue(PAYMENT_QUEUE) private readonly queue: Queue<PaymentJob>) {}

  /**
   * One delayed job per order. Like the mail producer, failures are logged rather than
   * thrown: a Redis hiccup must not fail a checkout that has already taken the money's
   * worth of stock — the sweeper will catch what this misses, which is exactly why the
   * sweeper exists.
   */
  async scheduleExpiry(orderId: string, delayMs: number): Promise<void> {
    try {
      await this.queue.add(
        'expire-payment',
        { type: 'expire-payment', orderId },
        { jobId: `expire-${orderId}`, delay: delayMs },
      );
    } catch (error) {
      logger.error({ err: error, orderId }, 'could not schedule payment expiry');
    }
  }

  /** Registered once at worker start. `upsertJobScheduler` is idempotent on the
   *  scheduler id, so restarting the worker re-registers the same sweeper instead of
   *  accumulating a new one each time. */
  async ensureSweeper(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP_JOB_ID,
      { every: everyMs },
      { name: 'sweep-expired', data: { type: 'sweep-expired' } },
    );
  }
}
