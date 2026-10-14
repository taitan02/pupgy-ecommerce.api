import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import type { AiMessageRole, AiStopReason } from '../../../generated/prisma/enums.js';

@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: { id: string; userId: string; shopId: string | null }) {
    return this.prisma.conversation.create({
      data: input,
      select: { id: true, shopId: true, title: true, createdAt: true, lastMessageAt: true },
    });
  }

  /**
   * Scoped by user on every read. The id is a UUIDv7 and therefore guessable in the
   * way any sequential id is, so ownership is a WHERE clause, never an assumption.
   */
  findOwned(id: string, userId: string) {
    return this.prisma.conversation.findFirst({
      where: { id, userId },
      select: { id: true, userId: true, shopId: true, title: true },
    });
  }

  listForUser(userId: string, params: { cursor?: string; limit: number }) {
    return this.prisma.conversation.findMany({
      where: { userId },
      select: { id: true, shopId: true, title: true, createdAt: true, lastMessageAt: true },
      orderBy: { lastMessageAt: 'desc' },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }

  listMessages(conversationId: string) {
    return this.prisma.conversationMessage.findMany({
      where: { conversationId },
      select: { id: true, role: true, content: true, model: true, stopReason: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The replayed context window: the newest N turns, oldest first once reversed. */
  async recentMessages(conversationId: string, limit: number) {
    const rows = await this.prisma.conversationMessage.findMany({
      where: { conversationId },
      select: { role: true, content: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.reverse();
  }

  /**
   * The user's turn and the conversation's new activity timestamp land together: a
   * thread whose last message is newer than its ordering key sorts wrongly in the
   * list, which is the one thing that list is for.
   */
  async appendUserMessage(input: {
    id: string;
    conversationId: string;
    content: string;
    title: string | null;
  }) {
    const [message] = await this.prisma.$transaction([
      this.prisma.conversationMessage.create({
        data: { id: input.id, conversationId: input.conversationId, role: 'USER', content: input.content },
        select: { id: true, createdAt: true },
      }),
      this.prisma.conversation.update({
        where: { id: input.conversationId },
        data: {
          lastMessageAt: new Date(),
          // Only when still unset: the title is the opening question, and a thread
          // that renames itself on every turn is unrecognisable in a list.
          ...(input.title ? { title: { set: input.title } } : {}),
        },
      }),
    ]);
    return message;
  }

  appendAssistantMessage(input: {
    id: string;
    conversationId: string;
    content: string;
    model: string;
    stopReason: AiStopReason;
  }) {
    return this.prisma.conversationMessage.create({
      data: { ...input, role: 'ASSISTANT' satisfies AiMessageRole },
      select: { id: true, createdAt: true },
    });
  }
}

/** Separate from the conversation read: the prompt needs the shop's name, and the
 *  status check keeps a closed shop from being named as current context. */
@Injectable()
export class AiShopLookup {
  constructor(private readonly prisma: PrismaService) {}

  findActive(shopId: string) {
    return this.prisma.shop.findFirst({
      where: { id: shopId, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
  }
}
