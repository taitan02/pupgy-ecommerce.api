import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

export interface AddressRecord {
  id: string;
  recipientName: string;
  phone: string;
  provinceName: string;
  wardName: string;
  streetLine: string;
  label: string | null;
  isDefault: boolean;
  createdAt: Date;
}

const FIELDS = {
  id: true,
  recipientName: true,
  phone: true,
  provinceName: true,
  wardName: true,
  streetLine: true,
  label: true,
  isDefault: true,
  createdAt: true,
} as const;

/**
 * Every method takes the user id and puts it in the WHERE clause. An address book is
 * personal data, so "find by id" alone is not an operation this repository offers —
 * the same reasoning as ADR-006, with the user as the isolation key instead of a shop.
 */
@Injectable()
export class AddressRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<AddressRecord[]> {
    // Default first, then newest: the list is short and the default is what the
    // shopper is looking for.
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: FIELDS,
    });
  }

  findOwned(userId: string, id: string): Promise<AddressRecord | null> {
    return this.prisma.address.findFirst({ where: { id, userId }, select: FIELDS });
  }

  count(userId: string): Promise<number> {
    return this.prisma.address.count({ where: { userId } });
  }

  /**
   * Writes the row and the "only one default" rule in one transaction. Postgres could
   * enforce it with a partial unique index, but Prisma 7 cannot declare one, and an
   * index that exists only in migration SQL is invisible to the schema diff — the next
   * `migrate dev` drops it silently. That already happened once with the SKU index.
   */
  async create(
    userId: string,
    data: Omit<AddressRecord, 'createdAt'>,
  ): Promise<AddressRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...data, userId }, select: FIELDS });
    });
  }

  async update(
    userId: string,
    id: string,
    data: Partial<Omit<AddressRecord, 'id' | 'createdAt'>>,
  ): Promise<AddressRecord> {
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.address.update({ where: { id }, data, select: FIELDS });
    });
  }

  /** Deleting the default promotes the next address, so checkout always has one. */
  async remove(userId: string, id: string, wasDefault: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });
      if (!wasDefault) return;

      const next = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (next) {
        await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }
}
