import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export enum ShopRoleDto {
  OWNER = 'OWNER',
  STAFF = 'STAFF',
}

export class CreateShopDto {
  @ApiProperty({ example: 'Tai Store' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({
    example: 'tai-store',
    description: 'Public URL segment: /shop/{slug}. Lowercase letters, digits and dashes.',
  })
  @Matches(/^[a-z0-9][a-z0-9-]{1,138}[a-z0-9]$/, {
    message: 'slug must be lowercase letters, digits or dashes',
  })
  slug!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateShopDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class AddMemberDto {
  @ApiProperty({ description: 'Must already have a platform account' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ShopRoleDto })
  @IsEnum(ShopRoleDto)
  role!: ShopRoleDto;
}

export class ShopResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] }) status!: string;
}

export class MyShopDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: ShopRoleDto, description: 'Your role in this shop' }) role!: string;
}

export class ShopMemberDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) fullName!: string | null;
  @ApiProperty({ enum: ShopRoleDto }) role!: string;
}
