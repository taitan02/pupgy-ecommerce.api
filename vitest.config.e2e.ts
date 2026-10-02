import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    /**
     * One spec file at a time.
     *
     * These are end-to-end tests: each file boots the whole application against the
     * one test database and the one Redis. Running them in parallel was fast (≈5s) and
     * intermittently wrong — roughly one run in three failed somewhere different, with
     * `socket hang up` and requests that never arrived, because every supertest call
     * opens its own ephemeral server and nine forks doing that at once exhausts what
     * the machine will hand out.
     *
     * Serially it is ≈15s and has not failed. Ten seconds is not worth a suite nobody
     * trusts: a flaky test is worse than a slow one, because it teaches you to ignore
     * red.
     */
    fileParallelism: false,
    // Some of these wait for a real email to travel over SMTP and show up in Mailpit.
    // The default 5s is tight enough that a slow machine fails for the wrong reason.
    testTimeout: 20_000,
    // Setup hooks register users, and registration runs argon2id — deliberately slow,
    // and slower still when several suites are competing for the thread pool.
    hookTimeout: 30_000,
  },
});
