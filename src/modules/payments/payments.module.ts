import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ShopsModule } from '../shops/shops.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SellerPaymentController } from './controllers/seller-payment.controller.js';
import { SepayWebhookController } from './controllers/sepay-webhook.controller.js';
import { PaymentAccountRepository } from './repositories/payment-account.repository.js';
import { PaymentRepository } from './repositories/payment.repository.js';
import { PaymentAccountService } from './services/payment-account.service.js';
import { PaymentService } from './services/payment.service.js';
import { PaymentQueue, PAYMENT_QUEUE } from './services/payment.queue.js';
import { SepayWebhookService } from './services/sepay-webhook.service.js';

/**
 * Producer side only — the expiry processor lives in the worker, like the mail one.
 *
 * Deliberately does not import OrdersModule: orders depend on payments (a QR checkout
 * opens one), so the reverse would be a cycle. The one thing payments need from orders
 * — cancelling an expired one — happens in the worker, where both are available.
 */
@Module({
  imports: [ShopsModule, NotificationsModule, BullModule.registerQueue({ name: PAYMENT_QUEUE })],
  controllers: [SellerPaymentController, SepayWebhookController],
  providers: [
    PaymentAccountRepository,
    PaymentRepository,
    PaymentAccountService,
    PaymentService,
    PaymentQueue,
    SepayWebhookService,
  ],
  // PaymentQueue is exported for the worker's expiry processor, which registers the
  // repeatable sweeper on it at boot.
  exports: [PaymentService, PaymentAccountService, PaymentAccountRepository, PaymentQueue],
})
export class PaymentsModule {}
