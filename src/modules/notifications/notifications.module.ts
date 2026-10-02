import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationService } from './notification.service.js';
import { MAIL_QUEUE } from './notification.types.js';

/**
 * Producer only. The processor lives in the worker entrypoint (`main.worker.ts`), so
 * the HTTP process cannot start doing the worker's job just because it imported the
 * wrong module.
 */
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
