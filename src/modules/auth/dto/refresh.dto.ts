import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AudienceDto } from './auth.dto.js';

/**
 * The audience is explicit rather than inferred: a browser may hold both a storefront
 * and a seller cookie at once (same person shopping and selling), and guessing which
 * one to rotate would be a coin flip.
 */
export class RefreshDto {
  @ApiProperty({ enum: AudienceDto })
  @IsEnum(AudienceDto)
  audience!: AudienceDto;
}
