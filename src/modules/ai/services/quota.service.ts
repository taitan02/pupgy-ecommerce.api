import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../infra/redis/redis.service.js';
import { AppError } from '../../../common/errors/app-error.js';
import { ErrorCode } from '../../../common/errors/error-codes.js';
import { logger } from '../../../infra/logger/logger.js';
import type { Env } from '../../../config/env.schema.js';

/** Two days, so yesterday's counters disappear without a sweeper. */
const KEY_TTL_SECONDS = 172_800;

@Injectable()
export class AiQuotaService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Counts the message before the model is called, and rejects when the day's
   * allowance is gone.
   *
   * **Fails closed**, unlike the login rate limiter. The two guard different things:
   * throttling login protects accounts, and letting logins through during a Redis
   * outage is the lesser harm; this protects a bill that someone else runs up, and a
   * counter that cannot be read is not permission to spend without limit.
   */
  async consumeMessage(userId: string): Promise<void> {
    const limit = this.config.get('AI_DAILY_MESSAGE_QUOTA', { infer: true });
    const tokenLimit = this.config.get('AI_DAILY_TOKEN_QUOTA', { infer: true });

    try {
      const [messages, tokens] = await Promise.all([
        this.increment(this.key('msg', userId), 1),
        this.read(this.key('tok', userId)),
      ]);

      if (messages > limit) throw quotaExceeded('daily message');
      // Checked, not enforced mid-stream: the answer in flight may cross the line, and
      // cutting it off would waste the tokens already paid for. The next message is
      // what gets refused.
      if (tokens >= tokenLimit) throw quotaExceeded('daily token');
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ err: error, userId }, 'AI quota check failed — refusing the request');
      throw new AppError(
        ErrorCode.INTERNAL,
        503,
        'AI is temporarily unavailable. Please try again shortly.',
      );
    }
  }

  /** What the UI shows before the user hits the wall. Reads the cache, not the rows:
   *  being a few tokens stale is fine for a progress hint. */
  async snapshot(userId: string) {
    const [messagesUsed, tokensUsed] = await Promise.all([
      this.read(this.key('msg', userId)),
      this.read(this.key('tok', userId)),
    ]);

    return {
      messagesUsed,
      messageLimit: this.config.get('AI_DAILY_MESSAGE_QUOTA', { infer: true }),
      tokensUsed,
      tokenLimit: this.config.get('AI_DAILY_TOKEN_QUOTA', { infer: true }),
    };
  }

  /** Called with the real usage once the stream ends — including a stream cut short. */
  async recordTokens(userId: string, tokens: number): Promise<void> {
    if (tokens <= 0) return;
    try {
      await this.increment(this.key('tok', userId), tokens);
    } catch (error) {
      // The authoritative numbers are already in ai_usage_records; losing the cached
      // counter costs accuracy for the rest of the day, not money.
      logger.error({ err: error, userId }, 'could not record AI token usage in Redis');
    }
  }

  private async increment(key: string, by: number): Promise<number> {
    const value = await this.redis.client.incrby(key, by);
    if (value === by) await this.redis.client.expire(key, KEY_TTL_SECONDS);
    return value;
  }

  private async read(key: string): Promise<number> {
    return Number((await this.redis.client.get(key)) ?? 0);
  }

  /**
   * The day boundary is Vietnam's, not UTC: a quota that resets at 7am local time
   * would look arbitrary to every user of this product.
   */
  private key(kind: 'msg' | 'tok', userId: string): string {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    return `ai:${kind}:${userId}:${today}`;
  }
}

function quotaExceeded(which: string): AppError {
  return new AppError(
    ErrorCode.RATE_LIMITED,
    429,
    `You have reached your ${which} limit for AI chat. It resets tomorrow.`,
  );
}
