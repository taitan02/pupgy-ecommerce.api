import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Cursor pagination everywhere, including admin tables. Offset pagination drifts when
 * rows are inserted while someone pages through, and gets slower the deeper you go.
 * Ids are UUIDv7, so ordering by id is ordering by creation time.
 */
export class CursorQueryDto {
  @ApiPropertyOptional({ description: 'Id of the last item from the previous page' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  // Query strings are text. @Type is explicit rather than relying on the pipe's
  // implicit conversion, which does not fire reliably for inferred property types.
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class CursorPageDto<T> {
  @ApiProperty({ isArray: true })
  items!: T[];

  @ApiProperty({ nullable: true, type: String, description: 'Pass as `cursor` for the next page' })
  nextCursor!: string | null;
}

/**
 * Takes one extra row to decide whether another page exists, then drops it.
 *
 * The return type is structural rather than CursorPageDto: callers that add fields of
 * their own (a total, a facet) spread this result, and spreading a class instance
 * drops its prototype.
 */
export function toCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
}
