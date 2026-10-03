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
  // Login throttling. Both scopes apply: per account (an attacker rotating IPs) and
  // per IP (an attacker spraying many accounts).
  RATE_LIMIT_LOGIN_PER_EMAIL: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_AUTH_PER_IP: z.coerce.number().int().positive().default(30),

  // Object storage. Cloudflare R2 in staging/production, MinIO locally — both speak
  // the S3 API, so only these values change between environments.
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  /// Where uploaded files are readable from: the R2 public domain, or MinIO locally.
  S3_PUBLIC_BASE_URL: z.string().min(1),

  // Mail. One transport everywhere: Mailpit locally, SendGrid's SMTP relay in
  // staging and production (username `apikey`, password = the API key). Using the
  // same protocol in both means the path we exercise daily is the path that ships
  // (ADR-013).
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  // STARTTLS on 587 is negotiated after connecting, so this stays false there and is
  // only true for implicit TLS on 465.
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /// Must be on a domain SendGrid has authenticated, or everything lands in spam.
  MAIL_FROM: z.string().default('no-reply@pupgy.local'),
  MAIL_FROM_NAME: z.string().default('Pupgy'),

  // Public URLs of the two frontends. Emails link into them, and a link is useless
  // if the API has to guess the host it is deployed behind.
  STOREFRONT_URL: z.string().default('http://localhost:3001'),
  SELLER_URL: z.string().default('http://localhost:3002'),

  /// How long a password-reset link stays usable. Short: it is emailed in clear text.
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),

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

  // Bull Board: a queue dashboard that can read job payloads and delete or replay
  // jobs. It is an admin surface, so it is off unless switched on and refuses to
  // start without a password (see the refinement below).
  BULL_BOARD_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  BULL_BOARD_USER: z.string().default('admin'),
  BULL_BOARD_PASSWORD: z.string().optional(),

  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
}).superRefine((env, ctx) => {
  // Fail at boot, not at the first request. A dashboard that exposes job payloads and
  // lets anyone replay jobs must never come up open, and the way to guarantee that is
  // to make "enabled without a password" a configuration that cannot start.
  if (env.BULL_BOARD_ENABLED && !env.BULL_BOARD_PASSWORD) {
    ctx.addIssue({
      code: 'custom',
      path: ['BULL_BOARD_PASSWORD'],
      message: 'BULL_BOARD_PASSWORD is required when BULL_BOARD_ENABLED=true',
    });
  }
});

export type Env = z.infer<typeof envSchema>;
