# syntax=docker/dockerfile:1.7

# Four stages, so the image that ships carries only what runs.
#
# Building needs TypeScript, the Nest CLI and the Prisma generator; running needs
# dist/, production node_modules and Node. Keeping them in one stage would ship the
# whole toolchain and every .ts file to a 1 GB VPS.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# The pnpm version comes from package.json's packageManager field, so the image and a
# developer's machine resolve the same tree.
RUN corepack enable
# Prisma's schema engine links against OpenSSL, which the slim image does not carry.
# Without it the CLI guesses a version and migrations fail in ways that read as
# unrelated errors.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app


FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile


FROM deps AS build
COPY . .
# prisma.config.ts resolves DATABASE_URL the moment it loads, so every prisma command
# needs one present — including `generate`, which never opens a connection. This value
# is thrown away with the stage; the real URL comes from the environment at runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
# `nest build` (tsc), never esbuild: esbuild drops emitDecoratorMetadata, which leaves
# Nest unable to resolve constructor types and kills the container at boot with
# "Cannot read properties of undefined (reading 'get')".
RUN pnpm prisma:generate && pnpm build


FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile


FROM base AS runner
ENV NODE_ENV=production

COPY --from=prod-deps /app/node_modules ./node_modules
# The generated Prisma client is compiled along with the rest of src/, so it arrives
# inside dist/ rather than in node_modules/.prisma as it would by default.
COPY --from=build /app/dist ./dist
# Migrations run from this image during a deploy, so the schema, the migration history
# and the config that supplies DATABASE_URL all have to be in it. Prisma 7 refuses a
# `url` in the datasource block, so prisma.config.ts is the only place that URL can
# come from.
#
# The CLI costs nothing extra to ship: @prisma/client declares `prisma` as a peer
# dependency, so a production install pulls its tree in either way. Keeping it out of
# the image only removed the node_modules/.bin link, not the 40 MB behind it.
COPY prisma ./prisma
COPY prisma.config.ts package.json ./

# Never root: a process that only serves HTTP has no reason to be able to write to
# its own image.
USER node

EXPOSE 3000

# Node 22 has global fetch, so the probe needs no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
