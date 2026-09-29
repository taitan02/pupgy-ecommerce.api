import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * RFC 9457 problem+json — the shape every failure leaves the API in.
 *
 * Declared in the contract because consumers need it: a spec that lists only success
 * responses tells generated clients that failure is impossible, and their error
 * handling stops type-checking.
 */
export class ProblemDto {
  @ApiProperty({ example: 'https://docs.pupgy.dev/errors/conflict' })
  type!: string;

  @ApiProperty({ example: 'Conflict' })
  title!: string;

  @ApiProperty({ example: 409 })
  status!: number;

  @ApiProperty({ example: 'This shop address is already taken' })
  detail!: string;

  @ApiProperty({
    example: 'CONFLICT',
    description: 'Stable machine code. Branch on this, never on the message text.',
  })
  code!: string;

  @ApiProperty({ format: 'uuid', description: 'Correlates with the server logs' })
  requestId!: string;

  @ApiPropertyOptional({ description: 'Field-level messages, when validation failed' })
  errors?: string[];

  // RFC 9457 extension member. Extension members belong to one problem type rather
  // than to every error, and they are declared here so generated clients can read
  // them without casting.
  @ApiPropertyOptional({
    description: 'On a cart stock conflict: how many the shop can actually ship',
  })
  availableStock?: number;
}
