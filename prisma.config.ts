import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer reads configuration from package.json, and with a config file
// present it does not load .env by itself — hence the dotenv import above.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/index.ts',
  },
});
