import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import type { ShopStatus } from '../../../generated/prisma/enums.js';

export interface ShopRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: ShopStatus;
  createdAt: Date;
}

const SHOP_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class ShopRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<ShopRecord | null> {
    return this.prisma.shop.findUnique({ where: { id }, select: SHOP_FIELDS });
  }

  findBySlug(slug: string): Promise<ShopRecord | null> {
    return this.prisma.shop.findUnique({ where: { slug }, select: SHOP_FIELDS });
  }

  /**
   * Creating a shop and its owner membership is one transaction: a shop with no owner
   * would be unreachable by anyone, including the person who just created it.
   */
  async createWithOwner(input: {
    shopId: string;
    memberId: string;
    ownerUserId: string;
    name: string;
    slug: string;
    description?: string;
  }): Promise<ShopRecord> {
    return this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          id: input.shopId,
          name: input.name,
          slug: input.slug,
          description: input.description,
        },
        select: SHOP_FIELDS,
      });

      await tx.shopMember.create({
        data: {
          id: input.memberId,
          shopId: shop.id,
          userId: input.ownerUserId,
          role: 'OWNER',
        },
      });

      return shop;
    });
  }

  update(id: string, data: { name?: string; description?: string }): Promise<ShopRecord> {
    return this.prisma.shop.update({ where: { id }, data, select: SHOP_FIELDS });
  }
}
