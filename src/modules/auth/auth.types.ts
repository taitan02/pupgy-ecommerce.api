import type { ShopRole, TokenAudience } from '../../generated/prisma/enums.js';

/** Claims inside the access token. Small on purpose: anything that can be revoked
 *  (membership, role) is looked up per request instead of being trusted from here. */
export interface AccessTokenPayload {
  sub: string; // user id
  aud: TokenAudience;
  jti: string; // session family, for correlating logs
}

export interface AuthenticatedUser {
  id: string;
  audience: TokenAudience;
}

/** Populated by ShopGuard after membership has been verified. */
export interface AuthorisedShop {
  id: string;
  role: ShopRole;
}

export const REFRESH_COOKIE: Record<TokenAudience, string> = {
  STOREFRONT: 'sf_rt',
  SELLER: 'sc_rt',
};

export const REFRESH_COOKIE_PATH = '/api/v1/auth/refresh';
