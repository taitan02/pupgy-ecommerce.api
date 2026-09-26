import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service.js';
import { RATE_LIMIT_KEY, type RateLimitRule } from './rate-limit.decorator.js';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { logger } from '../../infra/logger/logger.js';
import type { Env } from '../../config/env.schema.js';

/**
 * Registered globally but inert unless a route carries @RateLimit(...). Endpoints opt
 * in, because throttling everything uniformly is both wasteful and wrong: a login
 * attempt and a category listing deserve very different limits.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[]>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rules?.length) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    for (const rule of rules) {
      const scope = this.scopeFor(rule, request);
      if (!scope) continue; // e.g. no email in the body — nothing to throttle on

      const limit = this.config.get(rule.limitKey, { infer: true });
      const result = await this.rateLimit.consume(`${rule.name}:${scope}`, limit, rule.windowSeconds);

      if (!result.allowed) {
        http.getResponse<Response>().setHeader('retry-after', result.retryAfterSeconds);
        logger.warn({ rule: rule.name, path: request.path }, 'rate limit exceeded');

        throw new AppError(
          ErrorCode.RATE_LIMITED,
          429,
          'Too many attempts. Please try again later.',
          { retryAfterSeconds: result.retryAfterSeconds },
        );
      }
    }

    return true;
  }

  private scopeFor(rule: RateLimitRule, request: Request): string | undefined {
    if (rule.by === 'ip') return request.ip;

    const email = (request.body as { email?: unknown } | undefined)?.email;
    return typeof email === 'string' ? email.trim().toLowerCase() : undefined;
  }
}
