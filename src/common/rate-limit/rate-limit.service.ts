import { Injectable } from '@nestjs/common';
import { RedisService } from '../../infra/redis/redis.service.js';
import { logger } from '../../infra/logger/logger.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /**
   * Fixed-window counter: INCR the key, and set its TTL on first use. Simple enough
   * to reason about at a glance; the known trade-off is that a caller can send
   * `limit` requests at the end of one window and `limit` again at the start of the
   * next. For login throttling that is fine — the goal is to make brute force slow,
   * not to smooth traffic.
   */
  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;

    try {
      const count = await this.redis.client.incr(redisKey);
      if (count === 1) {
        await this.redis.client.expire(redisKey, windowSeconds);
      }

      if (count <= limit) {
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const ttl = await this.redis.client.ttl(redisKey);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
    } catch (error) {
      // Fail open. If Redis is down, blocking every login would turn a cache outage
      // into a full outage; an unthrottled window is the lesser harm, but it must be
      // loud in the logs.
      logger.error({ err: error, key }, 'rate limit check failed — allowing request');
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }
}
