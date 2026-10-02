import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { logger } from '../../infra/logger/logger.js';
import { jobIdFor, MAIL_QUEUE, type MailJob } from './notification.types.js';

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
@Injectable()
export class NotificationService {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJob>) {}

  async enqueue(job: MailJob): Promise<void> {
    try {
      await this.queue.add(job.type, job, { jobId: jobIdFor(job) });
    } catch (error) {
      logger.error({ err: error, job: job.type }, 'could not enqueue mail job');
    }
  }
}
