import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { RequestContext } from '../context/request-context.js';
import { logger } from '../../infra/logger/logger.js';

const REQUEST_ID_HEADER = 'x-request-id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Accept an inbound id so a request can be traced across storefront → API.
    // It is only used for correlation, never for any decision, so an attacker
    // supplying one gains nothing.
    const inbound = req.headers[REQUEST_ID_HEADER];
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound)?.trim() || uuidv7();

    res.setHeader(REQUEST_ID_HEADER, requestId);

    RequestContext.run({ requestId }, () => {
      const startedAt = process.hrtime.bigint();

      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        logger.info(
          {
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
          },
          'request completed',
        );
      });

      next();
    });
  }
}
