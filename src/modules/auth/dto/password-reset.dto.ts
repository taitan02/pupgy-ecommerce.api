import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsString, Length, MaxLength } from 'class-validator';
import { AudienceDto } from './auth.dto.js';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'tai@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({
    enum: AudienceDto,
    description: 'Which app the link should open — the password itself is shared (ADR-007)',
  })
  @IsEnum(AudienceDto)
  audience!: AudienceDto;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the emailed link' })
  @IsString()
  @Length(20, 200)
  token!: string;

  @ApiProperty({ minLength: 10, description: 'Minimum 10 characters, same rule as registration' })
  @IsString()
  @Length(10, 128)
  password!: string;
}
