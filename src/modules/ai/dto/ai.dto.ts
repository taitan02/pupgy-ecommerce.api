import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CursorQueryDto } from '../../../common/dto/cursor-page.dto.js';

export class StartConversationDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The shop the buyer is looking at. Context only — never a permission.',
  })
  @IsOptional()
  @IsUUID()
  shopId?: string;
}

export class SendMessageDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  content!: string;
}

export class ConversationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) shopId!: string | null;
  @ApiProperty({ nullable: true, type: String, description: 'The opening question, trimmed' })
  title!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) lastMessageAt!: string;
}

export class ConversationPageDto {
  @ApiProperty({ type: [ConversationDto] }) items!: ConversationDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

export class ConversationMessageDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['USER', 'ASSISTANT'] }) role!: string;
  @ApiProperty() content!: string;
  @ApiProperty({ nullable: true, type: String, description: 'Which model wrote it' })
  model!: string | null;
  @ApiProperty({
    enum: ['END_TURN', 'MAX_TOKENS', 'TOOL_USE', 'REFUSAL', 'ABORTED', 'FAILED'],
    nullable: true,
    type: String,
    description: 'MAX_TOKENS means the answer was cut off; ABORTED means nobody was listening',
  })
  stopReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class AiQuotaDto {
  @ApiProperty({ description: "Messages used today, in Vietnam's day" }) messagesUsed!: number;
  @ApiProperty() messageLimit!: number;
  @ApiProperty() tokensUsed!: number;
  @ApiProperty() tokenLimit!: number;
}

export class ConversationQueryDto extends CursorQueryDto {}
