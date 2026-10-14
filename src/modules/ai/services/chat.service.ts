import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v7 as uuidv7 } from 'uuid';
import { AiShopLookup, ConversationRepository } from '../repositories/conversation.repository.js';
import { AiUsageRepository } from '../repositories/ai-usage.repository.js';
import { AiQuotaService } from './quota.service.js';
import { buildSystemPrompt } from './system-prompt.js';
import { LLM_PROVIDER, type LlmProvider, type LlmUsage } from '../../../infra/llm/llm.types.js';
import { costMicroUsd } from '../../../infra/llm/model-pricing.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { logger } from '../../../infra/logger/logger.js';
import type { AiStopReason } from '../../../generated/prisma/enums.js';
import type { Env } from '../../../config/env.schema.js';

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: string; stopReason: AiStopReason };

const NO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

@Injectable()
export class ChatService {
  constructor(
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly conversations: ConversationRepository,
    private readonly shops: AiShopLookup,
    private readonly usage: AiUsageRepository,
    private readonly quota: AiQuotaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async createConversation(userId: string, shopId?: string) {
    this.requireEnabled();

    if (shopId && !(await this.shops.findActive(shopId))) {
      throw AppError.notFound('Shop not found');
    }

    return this.conversations.create({ id: uuidv7(), userId, shopId: shopId ?? null });
  }

  list(userId: string, params: { cursor?: string; limit: number }) {
    return this.conversations.listForUser(userId, params);
  }

  async messages(userId: string, conversationId: string) {
    const conversation = await this.conversations.findOwned(conversationId, userId);
    if (!conversation) throw AppError.notFound('Conversation not found');
    return this.conversations.listMessages(conversationId);
  }

  /**
   * One assistant turn, as a stream.
   *
   * The whole body runs inside try/finally for one reason: the tokens are billed the
   * moment the model generates them, so every exit path — a finished answer, a browser
   * that navigated away, a provider error — has to leave a usage row and a saved
   * message behind. A `return` out of the consumer's `for await` closes this generator
   * and runs that `finally`, which is what makes a disconnect meterable.
   */
  async *streamAnswer(input: {
    userId: string;
    conversationId: string;
    content: string;
    signal: AbortSignal;
  }): AsyncGenerator<ChatEvent> {
    this.requireEnabled();

    const conversation = await this.conversations.findOwned(input.conversationId, input.userId);
    if (!conversation) throw AppError.notFound('Conversation not found');

    await this.quota.consumeMessage(input.userId);

    await this.conversations.appendUserMessage({
      id: uuidv7(),
      conversationId: conversation.id,
      content: input.content,
      title: conversation.title ? null : input.content.slice(0, 120),
    });

    const shop = conversation.shopId ? await this.shops.findActive(conversation.shopId) : null;
    const history = await this.conversations.recentMessages(
      conversation.id,
      this.config.get('AI_HISTORY_WINDOW', { infer: true }),
    );

    const startedAt = Date.now();
    let answer = '';
    let model = this.config.get('AI_MODEL', { infer: true });
    let usage = NO_USAGE;
    let stopReason: AiStopReason = 'ABORTED';
    let errorCode: string | null = null;
    let messageId = '';

    try {
      const stream = this.llm.stream(
        {
          system: buildSystemPrompt({ shopName: shop?.name }),
          messages: history.map((message) => ({
            role: message.role === 'USER' ? ('user' as const) : ('assistant' as const),
            content: message.content,
          })),
          maxOutputTokens: this.config.get('AI_MAX_OUTPUT_TOKENS', { infer: true }),
        },
        input.signal,
      );

      for await (const event of stream) {
        switch (event.type) {
          case 'text':
            answer += event.text;
            yield { type: 'delta', text: event.text };
            break;
          case 'usage':
            model = event.model;
            usage = event.usage;
            break;
          case 'end':
            stopReason = event.stopReason;
            break;
        }
      }
    } catch (error) {
      // An abort is not a failure, and it reaches here as one: the provider rejects
      // the moment the signal fires. Nobody is on the other end to tell, so this
      // path records what was generated and returns quietly.
      if (input.signal.aborted) {
        stopReason = 'ABORTED';
      } else {
        stopReason = 'FAILED';
        errorCode = error instanceof Error ? error.name : 'UnknownError';
        logger.error({ err: error, conversationId: conversation.id }, 'AI stream failed');
        throw new AppError(ErrorCode.INTERNAL, 502, 'The assistant could not finish answering.');
      }
    } finally {
      // Not in the happy path alone: this is the only place that runs when the
      // consumer abandons the generator, and abandoning it is the normal way a
      // browser leaving mid-answer reaches this code.
      messageId = await this.persist({
        conversation,
        userId: input.userId,
        answer,
        model,
        usage,
        stopReason,
        errorCode,
        latencyMs: Date.now() - startedAt,
      });
    }

    // Outside the finally on purpose: a generator that is being closed or is throwing
    // never resumes, so a `yield` in there would be both unreachable and misleading.
    if (stopReason !== 'ABORTED') yield { type: 'done', messageId, stopReason };
  }

  /**
   * Writes the answer and what it cost. Never throws: this runs in a `finally`, and an
   * exception here would replace the real failure with a bookkeeping one.
   */
  private async persist(input: {
    conversation: { id: string; shopId: string | null };
    userId: string;
    answer: string;
    model: string;
    usage: LlmUsage;
    stopReason: AiStopReason;
    errorCode: string | null;
    latencyMs: number;
  }): Promise<string> {
    const messageId = uuidv7();

    try {
      if (input.answer.length > 0) {
        await this.conversations.appendAssistantMessage({
          id: messageId,
          conversationId: input.conversation.id,
          content: input.answer,
          model: input.model,
          stopReason: input.stopReason,
        });
      }

      await this.usage.record({
        id: uuidv7(),
        feature: 'SHOP_CHAT',
        userId: input.userId,
        shopId: input.conversation.shopId,
        conversationId: input.conversation.id,
        messageId: input.answer.length > 0 ? messageId : null,
        model: input.model,
        ...input.usage,
        costMicroUsd: costMicroUsd(input.model, input.usage),
        latencyMs: input.latencyMs,
        stopReason: input.stopReason,
        errorCode: input.errorCode,
      });

      await this.quota.recordTokens(
        input.userId,
        input.usage.inputTokens + input.usage.outputTokens,
      );
    } catch (error) {
      logger.error({ err: error, conversationId: input.conversation.id }, 'could not record AI usage');
    }

    return messageId;
  }

  private requireEnabled(): void {
    if (!this.config.get('ANTHROPIC_API_KEY', { infer: true })) {
      throw new AppError(ErrorCode.INTERNAL, 503, 'AI chat is not configured on this server.');
    }
  }
}
