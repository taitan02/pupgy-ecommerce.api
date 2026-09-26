import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import type { ShopRole } from '../../../generated/prisma/enums.js';

export interface MembershipRecord {
  shopId: string;
  userId: string;
  role: ShopRole;
}

@Injectable()
export class ShopMemberRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The authorisation lookup behind every seller request (ADR-006). A suspended shop
   * yields no membership, so suspension takes effect on the next request rather than
   * when some token expires.
   */
  async findActiveMembership(shopId: string, userId: string): Promise<MembershipRecord | null> {
    return this.prisma.shopMember.findFirst({
      where: { shopId, userId, shop: { status: 'ACTIVE' } },
      select: { shopId: true, userId: true, role: true },
    });
  }

  listByUser(userId: string): Promise<(MembershipRecord & { shop: { id: string; name: string; slug: string } })[]> {
    return this.prisma.shopMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        shopId: true,
        userId: true,
        role: true,
        shop: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  listByShop(shopId: string): Promise<
    (MembershipRecord & { createdAt: Date; user: { id: string; email: string; fullName: string | null } })[]
  > {
    return this.prisma.shopMember.findMany({
      where: { shopId },
      orderBy: { createdAt: 'asc' },
      select: {
        shopId: true,
        userId: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
  }

  create(input: { id: string; shopId: string; userId: string; role: ShopRole }): Promise<MembershipRecord> {
    return this.prisma.shopMember.create({
      data: input,
      select: { shopId: true, userId: true, role: true },
    });
  }

  async countOwners(shopId: string): Promise<number> {
    return this.prisma.shopMember.count({ where: { shopId, role: 'OWNER' } });
  }

  async remove(shopId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.shopMember.deleteMany({ where: { shopId, userId } });
    return result.count === 1;
  }
}
