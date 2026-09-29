import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AddressService } from '../services/address.service.js';
import { AddressDto, CreateAddressDto, UpdateAddressDto } from '../dto/address.dto.js';
import { CurrentUser, RequireAudience } from '../../../common/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/auth.types.js';

@ApiTags('storefront/addresses')
@ApiBearerAuth('access-token')
@RequireAudience('STOREFRONT')
@Controller('storefront/addresses')
export class StorefrontAddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  @ApiOperation({ summary: "The caller's address book, default first" })
  @ApiOkResponse({ type: [AddressDto] })
  list(@CurrentUser() user: AuthenticatedUser): Promise<AddressDto[]> {
    return this.addresses.list(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Save a delivery address' })
  @ApiOkResponse({ type: AddressDto })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAddressDto): Promise<AddressDto> {
    return this.addresses.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an address' })
  @ApiOkResponse({ type: AddressDto })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressDto> {
    return this.addresses.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an address; the default moves to the next one' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.addresses.remove(user.id, id);
  }
}
