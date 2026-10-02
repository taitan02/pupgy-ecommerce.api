import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module.js';
import { AddressesModule } from '../addresses/addresses.module.js';
import { ShopsModule } from '../shops/shops.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { StorefrontOrderController } from './controllers/storefront-order.controller.js';
import { SellerOrderController } from './controllers/seller-order.controller.js';
import { CheckoutService } from './services/checkout.service.js';
import { OrderService } from './services/order.service.js';
import { OrderRepository } from './repositories/order.repository.js';

@Module({
  imports: [CartModule, AddressesModule, ShopsModule, NotificationsModule], // ShopsModule: ShopGuard needs ShopMemberRepository
  controllers: [StorefrontOrderController, SellerOrderController],
  providers: [CheckoutService, OrderService, OrderRepository],
  exports: [OrderService],
})
export class OrdersModule {}
