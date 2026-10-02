# ecommerce-api

NestJS modular monolith. Owns every business rule, the database, and the OpenAPI
contract that `ecommerce-storefront` and `ecommerce-admin` consume.

## Run it

```bash
# 1. Infrastructure must be up first (see ecommerce-infrastructure)
cp .env.example .env
pnpm install
pnpm prisma:migrate        # create/apply migrations
pnpm prisma:seed           # platform category tree
pnpm start:dev             # http://localhost:3000
pnpm start:worker          # background jobs — a second terminal
```

`start:dev` serves HTTP. `start:worker` runs the BullMQ processors from the same
codebase through a different entrypoint (`main.worker.ts`). **Nothing sends email
unless the worker is running**, and the API stays perfectly healthy without it — jobs
simply pile up in Redis. Read what was sent at Mailpit: <http://localhost:8025>.

| URL | What |
|---|---|
| `/api/v1/health/live` | Liveness — never touches the database |
| `/api/v1/health/ready` | Readiness — checks the database; reports Redis without failing |
| `/api/v1/storefront/categories` | Public category tree |
| `/docs` | Swagger UI (disable in production) |

## Scripts

| Script | Purpose |
|---|---|
| `pnpm start:dev` | Watch mode, HTTP |
| `pnpm start:worker` | Watch mode, background jobs only (no port) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | oxlint, type-aware |
| `pnpm test` / `test:e2e` | Vitest unit / end-to-end (e2e needs a live database) |
| `pnpm openapi:generate` | Build, then write `openapi.json` |
| `pnpm openapi:check` | Fails if `openapi.json` drifts from the code — CI runs this |
| `pnpm prisma:migrate` / `prisma:seed` / `prisma:studio` | Database |
| `pnpm db:test:prepare` | Wipes and rebuilds the **test** database (port 5443). `test:e2e` runs it first so every run starts clean |

## Layout

```
src/
├── bootstrap/     app creation shared by the server and the OpenAPI script
├── config/        env schema (validated at boot) + config module
├── common/        request context, errors, filters, guards, shared DTOs
├── infra/         prisma, logger, (later) redis, queue, storage, mailer
├── modules/       one folder per bounded context
└── scripts/       build-time tools that need Nest DI
```

Inside a module:

```
<module>/
├── controllers/   split by audience: storefront-*.controller.ts vs seller-*.controller.ts
├── dto/           request and response contracts (never return Prisma models)
├── services/      business rules
└── repositories/  the ONLY place that queries the database
```

## Conventions that are not optional

- **Controllers are split by audience.** A single controller serving both the public
  storefront and authenticated sellers is how fields leak past an `if (isSeller)`.
- **Repositories own database access.** From Phase 4, shop-owned repositories take the
  shop from `RequestContext`, never from a caller argument. This is the mechanism
  ADR-006 relies on; bypassing it removes the tenant isolation guarantee.
- **Errors leave as problem+json** with a stable `code` and the `requestId`.
- **Money is an integer in VND.** No floats anywhere near a price.
- **ESM.** Relative imports end in `.js`, including in TypeScript source.
- **Do not boot Nest with `tsx`.** Verified here: `tsx src/scripts/generate-openapi.ts`
  fails with `Cannot read properties of undefined` because esbuild drops
  `emitDecoratorMetadata`, so every injected dependency arrives as `undefined`.
  Compile with `tsc` first (`nest build`). Vitest handles it correctly, so tests are
  unaffected; plain `tsx` scripts that need DI are not.

## Auth model (Phase 3)

One `User` identity; being a merchant means having a `ShopMember` row (ADR-007).

| Piece | Where it lives | Lifetime |
|---|---|---|
| Access token | JWT, client memory, `Authorization: Bearer` | 15 min |
| Refresh token | 32 random bytes, httpOnly cookie scoped to `/api/v1/auth/refresh`, **SHA-256 in the database** | 30 days, rotated on every use |

- **Sessions are per app.** The token's `aud` is `STOREFRONT` or `SELLER`, and
  `@RequireAudience()` rejects the wrong one. A stolen storefront token cannot reach
  Seller Center.
- **Rotation with reuse detection.** Each refresh token works once. Replaying a spent
  token revokes the entire family — we cannot distinguish victim from attacker, so the
  session ends.
- **…with a 10-second grace window** (`REFRESH_REUSE_GRACE_MS`). Two browser tabs
  refreshing at the same moment is normal and indistinguishable from theft; without
  the window, real users get logged out constantly. Inside it a retry is served; a
  token replayed later still kills the family. Tests run with the window disabled.
- **Authentication is on by default.** `JwtAuthGuard` is global; `@Public()` is the
  opt-out, so a forgotten decorator closes an endpoint instead of exposing one.
- **Login is throttled** per account (5 attempts / 5 min) and per IP (30 / 5 min),
  counted in Redis. Both scopes matter: per account stops a slow brute force spread
  across many IPs, per IP stops one host spraying many accounts. The limit counts
  *attempts*, so guessing correctly on attempt six is still refused.
- **Shop access is authorised per request.** The client selects a shop with
  `X-Shop-Id`; `ShopGuard` verifies membership against the database every time, so
  revoking a member takes effect immediately.

### Known gaps, deliberately
| Gap | Plan |
|---|---|
| No email verification | Post-MVP (v1.1) |
| Suspending a user does not kill live access tokens | Acceptable for a 15-minute window; revisit if it ever isn't |

## Mail and background jobs (Phase 8)

Transactional email is queued, never sent inline (ADR-013): a checkout must not be as
slow or as available as the mail provider.

| Piece | Where |
|---|---|
| Producer | `NotificationService.enqueue()` — swallows its own errors on purpose |
| Consumer | `MailProcessor`, provided only by `WorkerModule` |
| Transport | `MailService` — nodemailer over SMTP, Mailpit locally, SendGrid's relay in production |
| Templates | `modules/notifications/templates/*.ts` — plain functions, no template engine |

Three rules the code depends on:

1. **Enqueue after the transaction commits.** A worker can pick the job up before the
   commit lands and query for a row that does not exist yet.
2. **Jobs carry ids, not rendered content.** The worker re-reads and renders at send
   time, so a retried job describes what is true now — and a status email whose order
   has since moved on is dropped rather than sent.
3. **Job ids use `-`, never `:`.** BullMQ builds its Redis keys with colons and rejects
   an id containing one. Since enqueue failures are swallowed, a colon there would
   silently disable every email in the system with no failing request to show for it.
   That happened; `test/mail.e2e-spec.ts` now covers it.

### Password reset

`POST /auth/forgot-password` always answers `202`, for any address. Answering
differently would make it an oracle for which emails have accounts. Redeeming a link
revokes **every** session of that user, in both apps.

## Catalog model (Phase 4)

`Product` → `ProductOption` (≤ 2) → `ProductOptionValue`, and `Sku` as the thing that
is actually bought: one option combination with its own price and stock.

- **A SKU stores its option values in two columns**, not a join table. Two axes is a
  product rule (Shopee's model), so "find the SKU for this combination" stays one
  `WHERE` instead of a `GROUP BY … HAVING COUNT`.
- **Price and stock live on the SKU.** Listings show a range computed from them.
- **Constraints the database enforces itself** (see the `add_catalog` migration):
  non-negative price and stock, `position IN (1,2)`, a composite foreign key so a SKU
  cannot reference another shop's product, and a unique index on the option
  combination with `NULLS NOT DISTINCT` — without that, a product with no options
  could accumulate unlimited duplicate SKUs.
- **Products are never deleted**, only `ARCHIVED`: orders reference them.

### Product images

Uploads go **straight to object storage**, not through this API:

1. `POST /seller/products/:id/images/upload-url` returns a presigned PUT URL (5 min).
2. The browser PUTs the file to that URL.
3. `POST /seller/products/:id/images` registers it — and this is where the file is
   actually checked. A presigned PUT **cannot enforce a size limit**, so the API asks
   storage what landed (`HeadObject`); anything oversized or of the wrong type is
   deleted and rejected. The key is verified to sit under this shop's prefix.

Storage is the S3 API: **Cloudflare R2** in staging/production, **MinIO** locally.
Same code, different env values — see the `S3_*` block in `.env.example`.

Not yet: editing the option structure after creation, and image reordering.

### A Prisma trap worth remembering

An index that exists only in hand-written migration SQL is invisible to Prisma's
schema diff, and **the next `migrate dev` drops it as drift**. That happened to the
SKU-combination index; the test that inserts a duplicate caught it.

The fix is to declare the index in `schema.prisma` so Prisma owns it, and let the
migration re-create it with the clause Prisma cannot express (`NULLS NOT DISTINCT`).
CHECK constraints are safe by contrast — Prisma does not manage them at all.

Verify at any time that migrations and schema agree:

```bash
pnpm prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script
```

## Contract workflow

1. Change DTOs or controllers.
2. `pnpm openapi:generate`, commit `openapi.json` in the same PR.
3. Frontends regenerate their client from that file; a typecheck failure there is the
   contract doing its job.

Breaking changes to `/api/v1` are not allowed — add alongside, deprecate, then remove.
