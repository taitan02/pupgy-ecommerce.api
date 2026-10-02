import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema.js';

export const QUEUE_CONNECTION = 'QUEUE_CONNECTION';

/**
 * The connection alone, in its own module.
 *
 * It cannot live next to `BullModule.forRootAsync` in one module: Nest resolves a
 * module's `imports` before its own `providers`, so a factory in the imported dynamic
 * module cannot inject a token the importing module declares. Splitting it makes the
 * ordering explicit instead of a boot-time DI error.
 *
 * BullMQ needs `maxRetriesPerRequest: null` because a worker waits for jobs with a
 * blocking command and must not give up. RedisService deliberately does the opposite —
 * it fails fast, because rate limiting must never hang a request — so the two policies
 * cannot share a connection.
 */
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Redis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: null }),
    },
  ],
  exports: [QUEUE_CONNECTION],
})
export class QueueConnectionModule implements OnApplicationShutdown {
  constructor(@Inject(QUEUE_CONNECTION) private readonly connection: Redis) {}

  /** BullMQ closes connections it created, not one handed to it. Without this the
   *  process keeps a socket open and never exits — which shows up first as a test run
   *  that hangs after the last assertion. */
  async onApplicationShutdown(): Promise<void> {
    await this.connection.quit();
  }
}
