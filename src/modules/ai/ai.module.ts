import { Module } from '@nestjs/common';
import { LlmModule } from '../../infra/llm/llm.module.js';
import { StorefrontAiController } from './controllers/storefront-ai.controller.js';
import { ChatService } from './services/chat.service.js';
import { AiQuotaService } from './services/quota.service.js';
import { AiShopLookup, ConversationRepository } from './repositories/conversation.repository.js';
import { AiUsageRepository } from './repositories/ai-usage.repository.js';

@Module({
  imports: [LlmModule],
  controllers: [StorefrontAiController],
  providers: [ChatService, AiQuotaService, ConversationRepository, AiShopLookup, AiUsageRepository],
})
export class AiModule {}
