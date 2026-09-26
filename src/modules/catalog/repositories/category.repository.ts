import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';

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

  findAllActive(): Promise<CategoryRow[]> {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, parentId: true, name: true, slug: true },
    });
  }
}
