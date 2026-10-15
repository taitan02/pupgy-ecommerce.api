import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { categoryCountQuery } from './public-catalog.sql.js';

export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
}

/**
 * The only place in the catalog module allowed to touch the database. From Phase 4
 * onwards, shop-owned repositories read the shop from RequestContext and apply it
 * themselves — that convention is what ADR-006 depends on, so it starts here.
 *
 * Categories are platform-owned, so there is no shop filter on this one.
 */
@Injectable()
export class CategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async exists(id: string): Promise<boolean> {
    const category = await this.prisma.category.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    return category !== null;
  }

  findBySlug(slug: string): Promise<{ id: string } | null> {
    return this.prisma.category.findFirst({ where: { slug, isActive: true }, select: { id: true } });
  }

  /**
   * The category plus its active children. A category page lists everything below it,
   * so landing on a parent shows products even though products attach to leaves.
   */
  async findBranchBySlug(slug: string): Promise<{ id: string; ids: string[] } | null> {
    const category = await this.prisma.category.findFirst({
      where: { slug, isActive: true },
      select: { id: true, children: { where: { isActive: true }, select: { id: true } } },
    });
    if (!category) return null;

    return { id: category.id, ids: [category.id, ...category.children.map((child) => child.id)] };
  }

  /** Active products per category id, for the subcategory counts and the nav. */
  async countPublicProducts(): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<{ category_id: string; product_count: number }[]>(
      categoryCountQuery(),
    );
    return new Map(rows.map((row) => [row.category_id, row.product_count]));
  }

  findAllActive(): Promise<CategoryRow[]> {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, parentId: true, name: true, slug: true },
    });
  }
}
