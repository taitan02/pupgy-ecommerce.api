import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { PaymentExpiryService } from './services/payment-expiry.service.js';
import { PaymentQueue, PAYMENT_QUEUE, type PaymentJob } from './services/payment.queue.js';
import { logger } from '../../infra/logger/logger.js';

/** How often the safety net runs. Far more often than the 15-minute window, so a lost
 *  delayed job costs a buyer minutes of stock, not hours. */
const SWEEP_INTERVAL_MS = 60_000;

@Processor(PAYMENT_QUEUE)
export class PaymentProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly expiry: PaymentExpiryService,
    private readonly queue: PaymentQueue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.ensureSweeper(SWEEP_INTERVAL_MS);
    logger.info({ everyMs: SWEEP_INTERVAL_MS }, 'payment sweeper registered');
  }

  async process(job: Job<PaymentJob>): Promise<void> {
    switch (job.data.type) {
      case 'expire-payment':
        return this.expiry.expireOrder(job.data.orderId);
      case 'sweep-expired':
        await this.expiry.sweep();
        return;
    }
  }
}
