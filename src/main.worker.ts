import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module.js';
import { MailService } from './infra/mail/mail.service.js';
import { logger } from './infra/logger/logger.js';

/**
 * The background worker: the same codebase as the API, a different entrypoint
 * (architecture pack §5.1). It listens on no port — BullMQ processors only.
 *
 * `createApplicationContext` rather than `create`: there is no HTTP server here, and
 * booting one would open a port nothing should be talking to.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.enableShutdownHooks();

  // Check the relay at boot rather than discovering it is misconfigured when the first
  // order fails three times and lands in the failed set.
  const reachable = await app.get(MailService).verify();
  logger.info({ smtp: reachable ? 'ok' : 'unreachable' }, 'worker started');
}

await bootstrap();
