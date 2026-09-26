import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export enum AudienceDto {
  STOREFRONT = 'STOREFRONT',
  SELLER = 'SELLER',
}

export class RegisterDto {
  @ApiProperty({ example: 'tai@example.com' })
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(320)
  email!: string;

  @ApiProperty({
    example: 'correct-horse-battery',
    minLength: 10,
    description: 'Minimum 10 characters. Length beats character-class rules.',
  })
  @IsString()
  @Length(10, 128)
  password!: string;

  @ApiPropertyOptional({ example: 'Nguyễn Tài' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @Matches(/^[0-9+\- ]{8,20}$/, { message: 'phone contains invalid characters' })
  phone?: string;

  @ApiProperty({ enum: AudienceDto, description: 'Which app this session is for (ADR-007)' })
  @IsEnum(AudienceDto)
  audience!: AudienceDto;
}

export class LoginDto {
  @ApiProperty({ example: 'tai@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiProperty({ enum: AudienceDto })
  @IsEnum(AudienceDto)
  audience!: AudienceDto;
}

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ nullable: true, type: String }) fullName!: string | null;
}

export class AuthResponseDto {
  @ApiProperty({ description: 'JWT. Keep in memory; never in localStorage.' })
  accessToken!: string;

  @ApiProperty({ description: 'Seconds until the access token expires' })
  expiresIn!: number;

  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class TokenResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() expiresIn!: number;
}
