import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  // Reaches the queue through NotificationService, not through BullMQ directly: the
  // module that owns the queue is the one that answers questions about it.
  imports: [NotificationsModule],
  controllers: [HealthController],
})
export class HealthModule {}
