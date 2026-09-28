import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { ShopRepository, type ShopRecord } from '../repositories/shop.repository.js';
import { ShopMemberRepository } from '../repositories/shop-member.repository.js';
import { UserRepository } from '../../auth/repositories/user.repository.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { ShopRole } from '../../../generated/prisma/enums.js';

const MAX_SHOPS_PER_USER = 5;

@Injectable()
export class ShopService {
  constructor(
    private readonly shops: ShopRepository,
    private readonly members: ShopMemberRepository,
    private readonly users: UserRepository,
  ) {}

  async create(
    ownerUserId: string,
    input: { name: string; slug: string; description?: string },
  ): Promise<ShopRecord> {
    const slug = normaliseSlug(input.slug);

    if (RESERVED_SLUGS.has(slug)) {
      throw AppError.conflict('This shop address is reserved');
    }

    // Checked before insert for a clean error message; the unique index is what
    // actually prevents a duplicate under concurrency.
    if (await this.shops.findBySlug(slug)) {
      throw AppError.conflict('This shop address is already taken');
    }

    const existing = await this.members.listByUser(ownerUserId);
    if (existing.length >= MAX_SHOPS_PER_USER) {
      throw AppError.forbidden(`A user may own at most ${MAX_SHOPS_PER_USER} shops`);
    }

    return this.shops.createWithOwner({
      shopId: uuidv7(),
      memberId: uuidv7(),
      ownerUserId,
      name: input.name.trim(),
      slug,
      description: input.description?.trim(),
    });
  }

  async listMine(userId: string) {
    const memberships = await this.members.listByUser(userId);
    return memberships.map((membership) => ({
      id: membership.shop.id,
      name: membership.shop.name,
      slug: membership.shop.slug,
      role: membership.role,
    }));
  }

  /** Only ACTIVE shops exist as far as the storefront is concerned. */
  async getPublicBySlug(slug: string) {
    const shop = await this.shops.findBySlug(slug);
    if (!shop || shop.status !== 'ACTIVE') throw AppError.notFound('Shop not found');

    return { id: shop.id, name: shop.name, slug: shop.slug, description: shop.description };
  }

  /** Shops for the sitemap. */
  listPublicForSitemap(limit = 5000) {
    return this.shops.listActive(limit);
  }

  async getById(shopId: string): Promise<ShopRecord> {
    const shop = await this.shops.findById(shopId);
    if (!shop) throw AppError.notFound('Shop not found');
    return shop;
  }

  update(shopId: string, input: { name?: string; description?: string }): Promise<ShopRecord> {
    return this.shops.update(shopId, input);
  }

  listMembers(shopId: string) {
    return this.members.listByShop(shopId);
  }

  /**
   * Adds an existing platform user to this shop. There is no invite email yet, so the
   * person must already have an account — deliberately simple, and it avoids creating
   * accounts on someone else's behalf.
   */
  async addMember(shopId: string, email: string, role: ShopRole) {
    const user = await this.users.findByEmail(email);
    if (!user) {
      throw AppError.notFound('No platform account with this email');
    }

    if (await this.members.findActiveMembership(shopId, user.id)) {
      throw AppError.conflict('This user is already a member of the shop');
    }

    await this.members.create({ id: uuidv7(), shopId, userId: user.id, role });
    return { userId: user.id, email: user.email, role };
  }

  async removeMember(shopId: string, userId: string, actingUserId: string): Promise<void> {
    if (userId === actingUserId) {
      throw AppError.conflict('You cannot remove yourself from a shop');
    }

    const membership = await this.members.findActiveMembership(shopId, userId);
    if (!membership) throw AppError.notFound('Membership not found');

    // A shop with no owner can never be administered again, so the last one stays.
    if (membership.role === 'OWNER' && (await this.members.countOwners(shopId)) <= 1) {
      throw AppError.conflict('A shop must keep at least one owner');
    }

    await this.members.remove(shopId, userId);
  }
}

const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'seller',
  'shop',
  'shops',
  'cart',
  'checkout',
  'orders',
  'account',
  'login',
  'register',
  'search',
  'p',
  'c',
]);

/** Slugs end up in public URLs, so they are normalised rather than trusted. */
export function normaliseSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
