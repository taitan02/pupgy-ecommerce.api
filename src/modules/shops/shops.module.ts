import { Module } from '@nestjs/common';
import { SellerShopController } from './controllers/seller-shop.controller.js';
import { ShopService } from './services/shop.service.js';
import { ShopRepository } from './repositories/shop.repository.js';
import { ShopMemberRepository } from './repositories/shop-member.repository.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule], // for UserRepository, when adding a member by email
  controllers: [SellerShopController],
  providers: [ShopService, ShopRepository, ShopMemberRepository],
  // ShopMemberRepository is exported because ShopGuard depends on it.
  exports: [ShopService, ShopMemberRepository],
})
export class ShopsModule {}
