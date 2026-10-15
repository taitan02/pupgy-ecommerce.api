import { ApiProperty } from '@nestjs/swagger';

/**
 * The response shape is a deliberate contract, not "whatever the entity looks like".
 * Returning Prisma models directly is how internal columns leak into the public API
 * and how a schema change silently becomes a breaking change for the frontends.
 */
export class CategoryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Điện thoại' })
  name!: string;

  @ApiProperty({ example: 'dien-thoai', description: 'URL segment, unique platform-wide' })
  slug!: string;

  @ApiProperty({
    example: 96,
    description:
      'Active products in this category and its children. Catalog-wide: it does not narrow with the price or stock filters.',
  })
  productCount!: number;

  @ApiProperty({ type: () => [CategoryResponseDto], description: 'Direct children, ordered' })
  children!: CategoryResponseDto[];
}
