import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error.js';
import { ErrorCode } from '../errors/error-codes.js';
import { ROLES_KEY } from '../decorators/auth.decorators.js';
import { RequestContext } from '../context/request-context.js';
import { ShopMemberRepository } from '../../modules/shops/repositories/shop-member.repository.js';
import type { ShopRole } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser, AuthorisedShop } from '../../modules/auth/auth.types.js';

export const SHOP_HEADER = 'x-shop-id';

/**
 * Resolves and authorises the active shop for seller endpoints.
 *
 * The client *selects* a shop via the X-Shop-Id header; this guard *authorises* it by
 * looking up the caller's ShopMember row on every request. That lookup — not the
 * header — is the security boundary (ADR-006). Membership changes therefore take
 * effect immediately, unlike a shop id baked into a JWT.
 */
@Injectable()
export class ShopGuard implements CanActivate {
  constructor(
    private readonly members: ShopMemberRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser; shop?: AuthorisedShop }>();

    const user = request.user;
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, 'Authentication required');
    }

    const header = request.headers[SHOP_HEADER];
    const shopId = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!shopId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 400, `Missing ${SHOP_HEADER} header`);
    }

    const membership = await this.members.findActiveMembership(shopId, user.id);
    if (!membership) {
      // 403, not 404: the caller is authenticated and simply has no access. We do not
      // reveal whether the shop exists.
      throw AppError.forbidden('No access to this shop');
    }

    const requiredRoles = this.reflector.getAllAndOverride<ShopRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles?.length && !requiredRoles.includes(membership.role)) {
      throw AppError.forbidden('Your role does not allow this action');
    }

    request.shop = { id: membership.shopId, role: membership.role };
    RequestContext.set('shopId', membership.shopId);

    return true;
  }
}
