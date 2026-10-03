import { ConfigService } from '@nestjs/config';
import { createApp } from './bootstrap/create-app.js';
import { buildOpenApiDocument, setupSwaggerUi } from './bootstrap/swagger.js';
import { mountBullBoard } from './bootstrap/bull-board.js';
import { logger } from './infra/logger/logger.js';
import type { Env } from './config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    setupSwaggerUi(app, buildOpenApiDocument(app));
  }

  // Not inside createApp(): the OpenAPI generator uses that too, and a queue
  // dashboard has no business being part of generating the contract.
  mountBullBoard(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  logger.info({ port, env: config.get('NODE_ENV', { infer: true }) }, 'API listening');
}

await bootstrap();
