import type { LoggerService } from '@nestjs/common';
import { logger } from './logger.js';

/**
 * Bridges Nest's own logging (bootstrap, lifecycle, unhandled errors) into pino,
 * so the application has exactly one log format instead of two.
 */
export class NestPinoLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    logger.info({ context }, String(message));
  }

  error(message: unknown, stack?: string, context?: string): void {
    logger.error({ context, stack }, String(message));
  }

  warn(message: unknown, context?: string): void {
    logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string): void {
    logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string): void {
    logger.trace({ context }, String(message));
  }
}
