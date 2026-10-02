import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_CONNECTION, QueueConnectionModule } from './queue-connection.module.js';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [QueueConnectionModule],
      inject: [QUEUE_CONNECTION],
      useFactory: (connection: Redis) => ({
        connection,
        defaultJobOptions: {
          // Three attempts over roughly a minute. A provider still down after that is
          // an outage, not a blip, and the job belongs in the failed set where a human
          // can see it.
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          // Completed jobs prove delivery; failed jobs are the only record that an
          // email did not go out, so they are kept far longer.
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: { age: 604_800 },
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
