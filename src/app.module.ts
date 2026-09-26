import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ShopsModule } from './modules/shops/shops.module.js';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';

@Module({
  imports: [AppConfigModule, PrismaModule, HealthModule, AuthModule, ShopsModule, CatalogModule],
  providers: [
    // Authentication is the default for every route; @Public() is the explicit
    // opt-out. Forgetting the decorator closes an endpoint instead of exposing one.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*splat');
  }
}
