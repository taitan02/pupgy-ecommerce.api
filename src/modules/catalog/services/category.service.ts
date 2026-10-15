import { Injectable } from '@nestjs/common';
import { CategoryRepository, type CategoryRow } from '../repositories/category.repository.js';
import type { CategoryResponseDto } from '../dto/category-response.dto.js';

@Injectable()
export class CategoryService {
  constructor(private readonly categories: CategoryRepository) {}

  /**
   * Returns the category tree. Built in memory from one flat query rather than with
   * a recursive CTE or N queries per level: the tree is small (hundreds of rows),
   * platform-owned, and changes rarely. If it ever grows past that, this is the
   * place to add caching — not a second query pattern.
   */
  async getTree(): Promise<CategoryResponseDto[]> {
    const [rows, counts] = await Promise.all([
      this.categories.findAllActive(),
      this.categories.countPublicProducts(),
    ]);

    return buildTree(rows, counts);
  }
}

function buildTree(rows: CategoryRow[], counts: Map<string, number>): CategoryResponseDto[] {
  const byId = new Map<string, CategoryResponseDto>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      productCount: counts.get(row.id) ?? 0,
      children: [],
    });
  }

  const roots: CategoryResponseDto[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    // A child whose parent is inactive is not reachable, so it is dropped rather
    // than promoted to the root level.
    if (row.parentId === null) {
      roots.push(node);
    } else {
      byId.get(row.parentId)?.children.push(node);
    }
  }

  // Products hang off leaves, so a parent's own count is the sum of its branch. Done
  // after the tree is linked, over roots only: the depth is two and fixed by seed.
  for (const root of roots) {
    root.productCount += root.children.reduce((total, child) => total + child.productCount, 0);
  }

  return roots;
}
