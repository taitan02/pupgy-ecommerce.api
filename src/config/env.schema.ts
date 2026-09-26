import { z } from 'zod';

/**
 * Validated at boot. A missing or malformed variable must crash the process here,
 * not surface as a confusing runtime error three hours into production traffic.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // Signing key for access tokens. 32+ chars; rotating it invalidates every
  // access token immediately (refresh tokens survive — they are database rows).
  JWT_SECRET: z.string().min(32),
  // Short on purpose: a stolen access token expires quickly, and revocation is
  // handled at the refresh step where we can check the database.
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Window in which re-presenting a just-used refresh token is treated as a retry
  // (parallel tabs) rather than as theft. 0 disables it — strict rotation.
  REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).default(10_000),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // Comma-separated list of allowed browser origins (storefront, admin).
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3001,http://localhost:3002')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;
