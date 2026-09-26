import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from '../app.module.js';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter.js';
import { NestPinoLogger } from '../infra/logger/nest-logger.js';
import type { Env } from '../config/env.schema.js';

export const API_PREFIX = 'api/v1';

/**
 * Shared by the HTTP server and by the OpenAPI generator script, so the committed
 * spec always describes the app as it is actually configured.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new NestPinoLogger(),
    bufferLogs: true,
  });

  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.use(cookieParser()); // refresh tokens travel as httpOnly cookies

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true, // the refresh-token cookie depends on this
    exposedHeaders: ['x-request-id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties with no decorator…
      forbidNonWhitelisted: true, // …and reject the request that sent them
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks(); // in-flight requests finish before the process exits

  return app;
}
