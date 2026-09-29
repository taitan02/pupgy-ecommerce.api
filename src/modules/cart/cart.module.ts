import { Module } from '@nestjs/common';
import { StorefrontCartController } from './controllers/storefront-cart.controller.js';
import { CartService } from './services/cart.service.js';
import { CartRepository } from './repositories/cart.repository.js';

@Module({
  controllers: [StorefrontCartController],
  providers: [CartService, CartRepository],
  exports: [CartService],
})
export class CartModule {}
