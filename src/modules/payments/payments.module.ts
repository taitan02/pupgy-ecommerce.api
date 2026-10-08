import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ShopsModule } from '../shops/shops.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SellerFinanceController } from './controllers/seller-finance.controller.js';
import { SepayWebhookController } from './controllers/sepay-webhook.controller.js';
import { LedgerRepository } from './repositories/ledger.repository.js';
import { PaymentRepository } from './repositories/payment.repository.js';
import { PayoutRepository } from './repositories/payout.repository.js';
import { EscrowService } from './services/escrow.service.js';
import { PaymentService } from './services/payment.service.js';
import { PayoutService } from './services/payout.service.js';
import { ReleaseService } from './services/release.service.js';
import { SepayWebhookService } from './services/sepay-webhook.service.js';
import { PaymentQueue, PAYMENT_QUEUE } from './services/payment.queue.js';

/**
 * Producer side only — the expiry and auto-release processors live in the worker.
 *
 * Deliberately does not import OrdersModule: orders depend on payments (a checkout
 * opens one), so the reverse would be a cycle. The one thing payments need from orders
 * — cancelling an expired one — happens in the worker, where both are available.
 */
@Module({
  imports: [ShopsModule, NotificationsModule, BullModule.registerQueue({ name: PAYMENT_QUEUE })],
  controllers: [SellerFinanceController, SepayWebhookController],
  providers: [
    LedgerRepository,
    PaymentRepository,
    PayoutRepository,
    EscrowService,
    PaymentService,
    PayoutService,
    ReleaseService,
    SepayWebhookService,
    PaymentQueue,
  ],
  exports: [PaymentService, EscrowService, ReleaseService, LedgerRepository, PaymentQueue],
})
export class PaymentsModule {}
