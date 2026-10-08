import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { PaymentExpiryService } from './services/payment-expiry.service.js';
import { ReleaseService } from './services/release.service.js';
import { PaymentQueue, PAYMENT_QUEUE, type PaymentJob } from './services/payment.queue.js';
import { logger } from '../../infra/logger/logger.js';

/** Far more often than the payment window, so a lost delayed job costs a buyer minutes
 *  of held stock rather than hours. */
const SWEEP_INTERVAL_MS = 60_000;
/** Escrow release is measured in days, so checking hourly is plenty. */
const AUTO_RELEASE_INTERVAL_MS = 3_600_000;

@Processor(PAYMENT_QUEUE)
export class PaymentProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly expiry: PaymentExpiryService,
    private readonly release: ReleaseService,
    private readonly queue: PaymentQueue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.ensureSchedulers(SWEEP_INTERVAL_MS, AUTO_RELEASE_INTERVAL_MS);
    logger.info('payment sweeper and auto-release registered');
  }

  async process(job: Job<PaymentJob>): Promise<void> {
    switch (job.data.type) {
      case 'expire-payment':
        return this.expiry.expirePayment(job.data.paymentId);
      case 'sweep-expired':
        await this.expiry.sweep();
        return;
      case 'auto-release':
        await this.release.autoRelease();
        return;
    }
  }
}
