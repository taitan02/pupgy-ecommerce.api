import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer reads configuration from package.json, and with a config file
// present it does not load .env by itself — hence the dotenv import above.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
    // Scratch database used by `migrate dev` and `migrate diff` to replay the
    // migration history and compare it with the schema. Never the dev database.
    //
    // Read straight from process.env rather than through env(), which throws when the
    // variable is absent: this is a development-only concept, and a production server
    // running `migrate deploy` has no shadow database to point at.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/index.ts',
  },
});
