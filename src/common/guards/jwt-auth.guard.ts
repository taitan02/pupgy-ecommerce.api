import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { AUDIENCE_KEY, IS_PUBLIC_KEY } from '../decorators/auth.decorators.js';
import { RequestContext } from '../context/request-context.js';
import type { AccessTokenPayload, AuthenticatedUser } from '../../modules/auth/auth.types.js';

/**
 * Registered globally: every route requires authentication unless it opts out with
 * @Public(). The failure mode matters — a forgotten decorator returns 401 on an
 * endpoint that should have been open, which someone notices in minutes, instead of
 * silently exposing one that should have been closed.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, controller])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Missing access token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      // Expired and malformed are deliberately indistinguishable to the caller.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Invalid or expired access token');
    }

    const required = this.reflector.getAllAndOverride<'STOREFRONT' | 'SELLER'>(AUDIENCE_KEY, [
      handler,
      controller,
    ]);
    if (required && payload.aud !== required) {
      // A storefront token on a seller route: the same human, the wrong credential.
      throw AppError.forbidden('Token audience not allowed for this endpoint');
    }

    request.user = { id: payload.sub, audience: payload.aud };
    RequestContext.set('userId', payload.sub);

    return true;
  }
}

function extractBearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}
