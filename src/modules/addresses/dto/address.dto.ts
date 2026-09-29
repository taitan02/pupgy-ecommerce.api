import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * Vietnam removed the district level on 1 July 2025, so there are two administrative
 * levels here, not three: Tỉnh/Thành phố → Phường/Xã.
 *
 * The names are free text for now. Turning them into dependent pickers needs the
 * official administrative-unit dataset; the `provinceCode`/`wardCode` columns are in
 * the table waiting for it, so adding the dataset later is not a data migration.
 */
export class CreateAddressDto {
  @ApiProperty({ example: 'Nguyễn Minh Tài' })
  @IsString()
  @Length(2, 120)
  recipientName!: string;

  @ApiProperty({ example: '0912345678', description: '10 digits, starting with 0' })
  @Matches(/^0\d{9}$/, { message: 'phone must be 10 digits and start with 0' })
  phone!: string;

  @ApiProperty({ example: 'TP. Hồ Chí Minh' })
  @IsString()
  @Length(2, 120)
  provinceName!: string;

  @ApiProperty({ example: 'Phường Võ Thị Sáu' })
  @IsString()
  @Length(2, 120)
  wardName!: string;

  @ApiProperty({ example: '128/4 Trần Quốc Thảo' })
  @IsString()
  @Length(3, 200)
  streetLine!: string;

  @ApiPropertyOptional({ example: 'Nhà riêng', maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @ApiPropertyOptional({ description: 'Pre-select this address at checkout' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  recipientName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^0\d{9}$/, { message: 'phone must be 10 digits and start with 0' })
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  provinceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  wardName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 200)
  streetLine?: string;

  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class AddressDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() recipientName!: string;
  @ApiProperty() phone!: string;
  @ApiProperty() provinceName!: string;
  @ApiProperty() wardName!: string;
  @ApiProperty() streetLine!: string;
  @ApiProperty({ nullable: true, type: String }) label!: string | null;
  @ApiProperty() isDefault!: boolean;

  @ApiProperty({
    example: '128/4 Trần Quốc Thảo, Phường Võ Thị Sáu, TP. Hồ Chí Minh',
    description: 'The address on one line, formatted once here so every client agrees',
  })
  formatted!: string;
}
