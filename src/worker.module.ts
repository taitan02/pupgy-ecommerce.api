import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { StorageModule } from './infra/storage/storage.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { MailModule } from './infra/mail/mail.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { ShopsModule } from './modules/shops/shops.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { MailProcessor } from './modules/notifications/mail.processor.js';

/**
 * The worker's module graph: infrastructure, the services a job needs to read, and the
 * processors. No controllers and no guards — this process serves no HTTP traffic.
 *
 * It deliberately does not import NotificationsModule: that is the producer, and a
 * worker that could also enqueue would make the direction of the queue a matter of
 * opinion.
 */
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    // The order services render image URLs, so they need the storage module even
    // though the worker never uploads anything.
    StorageModule,
    QueueModule,
    MailModule,
    AuthModule,
    ShopsModule,
    OrdersModule,
  ],
  providers: [MailProcessor],
})
export class WorkerModule {}
