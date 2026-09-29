import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AddressRepository, type AddressRecord } from '../repositories/address.repository.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { AddressDto, CreateAddressDto, UpdateAddressDto } from '../dto/address.dto.js';

/** A shopper with more than this many addresses is not shopping, and the picker at
 *  checkout stops being a picker. */
const MAX_ADDRESSES = 10;

@Injectable()
export class AddressService {
  constructor(private readonly addresses: AddressRepository) {}

  async list(userId: string): Promise<AddressDto[]> {
    const rows = await this.addresses.list(userId);
    return rows.map(toDto);
  }

  async create(userId: string, dto: CreateAddressDto): Promise<AddressDto> {
    const existing = await this.addresses.count(userId);
    if (existing >= MAX_ADDRESSES) {
      throw AppError.conflict(`You can save at most ${MAX_ADDRESSES} addresses`);
    }

    const created = await this.addresses.create(userId, {
      id: uuidv7(),
      recipientName: dto.recipientName.trim(),
      phone: dto.phone,
      provinceName: dto.provinceName.trim(),
      wardName: dto.wardName.trim(),
      streetLine: dto.streetLine.trim(),
      label: dto.label?.trim() ?? null,
      // The first address is the default whatever the client asked for: an address
      // book where nothing is selected makes checkout ask a question with one answer.
      isDefault: existing === 0 || dto.isDefault === true,
    });

    return toDto(created);
  }

  async update(userId: string, id: string, dto: UpdateAddressDto): Promise<AddressDto> {
    const current = await this.addresses.findOwned(userId, id);
    if (!current) throw AppError.notFound('Address not found');

    if (current.isDefault && dto.isDefault === false) {
      // Unsetting the default would leave none. Making another one default is how you
      // move it, and that path already clears this row.
      throw AppError.conflict('Set another address as default instead');
    }

    const updated = await this.addresses.update(userId, id, {
      recipientName: dto.recipientName?.trim(),
      phone: dto.phone,
      provinceName: dto.provinceName?.trim(),
      wardName: dto.wardName?.trim(),
      streetLine: dto.streetLine?.trim(),
      label: dto.label?.trim(),
      isDefault: dto.isDefault,
    });

    return toDto(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const current = await this.addresses.findOwned(userId, id);
    if (!current) throw AppError.notFound('Address not found');
    await this.addresses.remove(userId, id, current.isDefault);
  }
}

function toDto(row: AddressRecord): AddressDto {
  return {
    id: row.id,
    recipientName: row.recipientName,
    phone: row.phone,
    provinceName: row.provinceName,
    wardName: row.wardName,
    streetLine: row.streetLine,
    label: row.label,
    isDefault: row.isDefault,
    formatted: [row.streetLine, row.wardName, row.provinceName].join(', '),
  };
}
