import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit:rules';

export interface RateLimitRule {
  /** Part of the Redis key, so it must be unique per endpoint + scope. */
  name: string;
  /** Which env setting holds the limit. Decorators run before DI exists, so the
   *  number itself is resolved by the guard at request time. */
  limitKey: 'RATE_LIMIT_LOGIN_PER_EMAIL' | 'RATE_LIMIT_AUTH_PER_IP';
  windowSeconds: number;
  /** `ip` throttles a source; `email` throttles one account regardless of source. */
  by: 'ip' | 'email';
}

export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMIT_KEY, rules);
