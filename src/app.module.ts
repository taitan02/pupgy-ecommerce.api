import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { StorageModule } from './infra/storage/storage.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { MailModule } from './infra/mail/mail.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ShopsModule } from './modules/shops/shops.module.js';
import { AddressesModule } from './modules/addresses/addresses.module.js';
import { CartModule } from './modules/cart/cart.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard.js';
import { RateLimitService } from './common/rate-limit/rate-limit.service.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    QueueModule,
    MailModule,
    HealthModule,
    AuthModule,
    ShopsModule,
    CatalogModule,
    AddressesModule,
    CartModule,
    OrdersModule,
  ],
  providers: [
    // Authentication is the default for every route; @Public() is the explicit
    // opt-out. Forgetting the decorator closes an endpoint instead of exposing one.
    // Order matters: throttle before doing any authentication work, so a flood of
    // bad logins never reaches argon2 or the database.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    RateLimitService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*splat');
  }
}
