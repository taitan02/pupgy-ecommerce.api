import { Prisma } from '../../../generated/prisma/client.js';

export type PublicSort = 'newest' | 'price_asc' | 'price_desc';

export interface PublicListFilters {
  /** The category and, when it is a parent, its children. */
  categoryIds?: string[];
  shopSlug?: string;
  query?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
}

/**
 * The public catalog query, as SQL fragments shared by the page query and the count.
 *
 * Raw SQL rather than Prisma because every interesting thing on a storefront listing
 * is an aggregate over the SKUs: the price shown is the cheapest one, "còn hàng"
 * means at least one sellable SKU has stock, and "150k – 500k" matches a product when
 * any single SKU falls in the range. Prisma can filter on a relation but cannot order
 * by an aggregate of it, and cannot call f_unaccent() at all.
 *
 * The INNER JOIN on skus also drops products with no SKUs, which have no price to
 * show and cannot be bought.
 */
function core(filters: PublicListFilters, extraHaving: Prisma.Sql[] = []): Prisma.Sql {
  const where: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`, Prisma.sql`sh.status = 'ACTIVE'`];
  const having = [...extraHaving];

  if (filters.categoryIds?.length) {
    const ids = filters.categoryIds.map((id) => Prisma.sql`${id}::uuid`);
    where.push(Prisma.sql`p.category_id IN (${Prisma.join(ids)})`);
  }
  if (filters.shopSlug) {
    where.push(Prisma.sql`sh.slug = ${filters.shopSlug}`);
  }
  if (filters.query) {
    // Accent-insensitive in both directions: "ao khoac" finds "Áo khoác" and the
    // other way round. f_unaccent is the IMMUTABLE wrapper the GIN trigram index is
    // built on, so this stays indexable.
    where.push(Prisma.sql`f_unaccent(p.name) ILIKE f_unaccent(${`%${filters.query}%`})`);
  }
  // One bool_or over both bounds, so "any SKU inside the range" stays one SKU rather
  // than one SKU above the floor and a different one below the ceiling. An absent
  // bound is left out of the SQL instead of standing in as a huge number, which
  // Postgres would reject against an integer column.
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined) {
    having.push(Prisma.sql`bool_or(s.price BETWEEN ${filters.minPrice} AND ${filters.maxPrice})`);
  } else if (filters.minPrice !== undefined) {
    having.push(Prisma.sql`bool_or(s.price >= ${filters.minPrice})`);
  } else if (filters.maxPrice !== undefined) {
    having.push(Prisma.sql`bool_or(s.price <= ${filters.maxPrice})`);
  }
  if (filters.inStockOnly) {
    having.push(Prisma.sql`bool_or(s.stock > 0 AND s.is_sellable)`);
  }

  return Prisma.sql`
    FROM products p
    JOIN shops sh ON sh.id = p.shop_id
    JOIN skus s ON s.product_id = p.id
    WHERE ${Prisma.join(where, ' AND ')}
    GROUP BY p.id, p.shop_id
    ${having.length > 0 ? Prisma.sql`HAVING ${Prisma.join(having, ' AND ')}` : Prisma.empty}
  `;
}

/**
 * Ids for one page, in display order.
 *
 * The cursor stays a plain product id even when sorting by price: the row it points
 * at has its own minimum price, so the keyset comparison looks that price up in a
 * subquery instead of the client carrying an encoded pair. A cursor whose product has
 * since disappeared makes the comparison NULL, which ends the listing rather than
 * silently restarting it from the top.
 */
export function publicPageQuery(params: {
  filters: PublicListFilters;
  sort: PublicSort;
  cursor?: string;
  limit: number;
}): Prisma.Sql {
  const { cursor, sort } = params;
  const keyset: Prisma.Sql[] = [];

  if (cursor) {
    const at = Prisma.sql`${cursor}::uuid`;
    const cheapest = Prisma.sql`(SELECT min(price) FROM skus WHERE product_id = ${at})`;
    keyset.push(
      {
        newest: Prisma.sql`p.id < ${at}`,
        price_asc: Prisma.sql`(min(s.price), p.id) > (${cheapest}, ${at})`,
        price_desc: Prisma.sql`(min(s.price), p.id) < (${cheapest}, ${at})`,
      }[sort],
    );
  }

  const order = {
    // Ids are UUIDv7, so ordering by id is ordering by creation time.
    newest: Prisma.sql`p.id DESC`,
    price_asc: Prisma.sql`min(s.price) ASC, p.id ASC`,
    price_desc: Prisma.sql`min(s.price) DESC, p.id DESC`,
  }[sort];

  // The keyset is a HAVING condition because two of the three reference min(s.price);
  // the id-only case is equally valid there and keeps the query one shape.
  return Prisma.sql`
    SELECT p.id
    ${core(params.filters, keyset)}
    ORDER BY ${order}
    LIMIT ${params.limit + 1}
  `;
}

/** Both numbers the listing header shows, in one pass over the same filters. */
export function publicCountQuery(filters: PublicListFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*)::int AS total, count(DISTINCT shop_id)::int AS shop_count
    FROM (SELECT p.shop_id ${core(filters)}) matched
  `;
}

/** Live product counts per category, for the subcategory list and the nav. */
export function categoryCountQuery(): Prisma.Sql {
  return Prisma.sql`
    SELECT p.category_id, count(DISTINCT p.id)::int AS product_count
    FROM products p
    JOIN shops sh ON sh.id = p.shop_id
    JOIN skus s ON s.product_id = p.id
    WHERE p.status = 'ACTIVE' AND sh.status = 'ACTIVE'
    GROUP BY p.category_id
  `;
}
