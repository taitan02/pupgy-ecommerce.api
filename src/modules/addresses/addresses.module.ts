import { Module } from '@nestjs/common';
import { StorefrontAddressController } from './controllers/storefront-address.controller.js';
import { AddressService } from './services/address.service.js';
import { AddressRepository } from './repositories/address.repository.js';

@Module({
  controllers: [StorefrontAddressController],
  providers: [AddressService, AddressRepository],
  exports: [AddressService],
})
export class AddressesModule {}
