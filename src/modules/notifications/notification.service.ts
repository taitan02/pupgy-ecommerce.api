import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { logger } from '../../infra/logger/logger.js';
import { jobIdFor, jobRetentionFor, MAIL_QUEUE, type MailJob } from './notification.types.js';

/**
 * The producer side. Everything that wants an email sent calls this and moves on.
 *
 * Two rules the callers depend on:
 *
 * 1. **Call it after the transaction commits, never inside one.** A worker can pick
 *    the job up before the commit lands and query for a row that does not exist yet —
 *    a failure that looks impossible in the logs. A rolled-back transaction would also
 *    leave an email announcing something that never happened.
 * 2. **Enqueuing must not be able to fail the request.** Redis being down is a reason
 *    for an email to be late, not a reason for a checkout to fail, so the error is
 *    logged and swallowed here rather than thrown at the caller.
 */
export interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  /** null when nothing is waiting. */
  oldestWaitingSeconds: number | null;
}

@Injectable()
export class NotificationService {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJob>) {}

  /**
   * What the health endpoint reports. Not `completed`: that number is the platform's
   * order volume, and this endpoint is unauthenticated like the other probes.
   *
   * `oldestWaitingSeconds` is the one that matters. A queue with work in it and
   * nothing consuming means the worker is not running — the failure mode where the
   * API answers every request perfectly and no email has gone out for a day.
   */
  async stats(): Promise<QueueStats> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');

    // A bounded sample rather than the whole list, and the minimum of it rather than
    // trusting the list's order to be chronological.
    const waiting = await this.queue.getWaiting(0, 50);
    const oldest = waiting.reduce<number | null>(
      (min, job) => (min === null || job.timestamp < min ? job.timestamp : min),
      null,
    );

    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      oldestWaitingSeconds: oldest === null ? null : Math.round((Date.now() - oldest) / 1000),
    };
  }

  async enqueue(job: MailJob): Promise<void> {
    try {
      await this.queue.add(job.type, job, { jobId: jobIdFor(job), ...jobRetentionFor(job) });
    } catch (error) {
      logger.error({ err: error, job: job.type }, 'could not enqueue mail job');
    }
  }
}
