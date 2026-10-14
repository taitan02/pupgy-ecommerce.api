import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import type { AiFeature, AiStopReason } from '../../../generated/prisma/enums.js';

export interface UsageInput {
  id: string;
  feature: AiFeature;
  userId: string;
  shopId: string | null;
  conversationId: string | null;
  messageId: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  stopReason: AiStopReason;
  errorCode: string | null;
}

@Injectable()
export class AiUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  record(input: UsageInput) {
    return this.prisma.aiUsageRecord.create({ data: input, select: { id: true } });
  }

  /** The authoritative spend for a window. The Redis counters are a cache of this. */
  async totalsSince(userId: string, since: Date) {
    const result = await this.prisma.aiUsageRecord.aggregate({
      where: { userId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true },
    });

    return {
      calls: result._count._all,
      inputTokens: result._sum.inputTokens ?? 0,
      outputTokens: result._sum.outputTokens ?? 0,
      costMicroUsd: result._sum.costMicroUsd ?? 0,
    };
  }
}
