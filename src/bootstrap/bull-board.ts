import { timingSafeEqual } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { createBullBoard } from '@bull-board/api';
// Subpath without a `.js` suffix: this one is a package export key, not a relative
// path, so it has to match the exports map exactly.
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import type { Queue } from 'bullmq';
import { MAIL_QUEUE } from '../modules/notifications/notification.types.js';
import { logger } from '../infra/logger/logger.js';
import type { Env } from '../config/env.schema.js';

export const BULL_BOARD_PATH = '/admin/queues';

/**
 * Mounts the queue dashboard, if it is switched on.
 *
 * This is an **admin surface**, not a status page: it shows job payloads and lets the
 * viewer delete and replay jobs. Three things follow from that.
 *
 * It is raw Express, so none of Nest's guards apply — `JwtAuthGuard` is an APP_GUARD
 * and never sees these requests. The Basic auth below is the entire access control,
 * which is why it is here and not assumed from somewhere else.
 *
 * It is off by default, and the config refuses to boot when it is on without a
 * password. A dashboard that comes up open because an environment variable was missed
 * is exactly the accident worth designing out.
 *
 * It mounts outside the API prefix, so nothing here is part of the public contract.
 */
export function mountBullBoard(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  if (!config.get('BULL_BOARD_ENABLED', { infer: true })) return;

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);

  createBullBoard({
    queues: [new BullMQAdapter(app.get<Queue>(getQueueToken(MAIL_QUEUE)))],
    serverAdapter,
  });

  app.use(BULL_BOARD_PATH, basicAuth(config), serverAdapter.getRouter());
  logger.warn({ path: BULL_BOARD_PATH }, 'Bull Board mounted — admin surface, keep it private');
}

function basicAuth(config: ConfigService<Env, true>) {
  const expectedUser = config.get('BULL_BOARD_USER', { infer: true });
  // Non-null: the schema refuses to start with the board enabled and no password.
  const expectedPassword = config.get('BULL_BOARD_PASSWORD', { infer: true })!;

  return (request: Request, response: Response, next: NextFunction): void => {
    const header = request.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');

    if (scheme === 'Basic' && encoded) {
      const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
      // Comparison is constant-time: a plain `===` leaks the password one character
      // at a time to anyone who can measure the response.
      if (user === expectedUser && constantTimeEquals(rest.join(':'), expectedPassword)) {
        next();
        return;
      }
    }

    response
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="Pupgy queues", charset="UTF-8"')
      .send('Authentication required');
  };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself be a leak, so the
  // lengths are folded into the result instead of short-circuiting on them.
  return left.length === right.length && timingSafeEqual(left, right);
}
