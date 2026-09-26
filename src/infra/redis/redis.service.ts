import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { logger } from '../logger/logger.js';
import type { Env } from '../../config/env.schema.js';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      // Give up after a couple of retries so a Redis outage surfaces as a rejected
      // promise the caller can handle — for rate limiting that means letting traffic
      // through — instead of hanging the request. The offline queue stays on so
      // commands issued during startup wait for the connection rather than failing.
      maxRetriesPerRequest: 2,
    });

    this.client.on('error', (error: Error) => logger.error({ err: error }, 'redis error'));
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
