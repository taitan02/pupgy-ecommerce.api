import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ShopRole } from '../../generated/prisma/enums.js';
import type { AuthenticatedUser, AuthorisedShop } from '../../modules/auth/auth.types.js';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const AUDIENCE_KEY = 'auth:audience';
export const ROLES_KEY = 'auth:roles';

/** Opens a route to unauthenticated traffic. Authentication is on by default, so
 *  forgetting this decorator locks an endpoint loudly instead of exposing it quietly. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to one token audience (ADR-007): a storefront token must not
 *  work on seller endpoints even though it belongs to the same user. */
export const RequireAudience = (audience: 'STOREFRONT' | 'SELLER') =>
  SetMetadata(AUDIENCE_KEY, audience);

/** Requires one of these roles in the shop resolved by ShopGuard. */
export const RequireRoles = (...roles: ShopRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
});

export const CurrentShop = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ shop?: AuthorisedShop }>().shop;
});
