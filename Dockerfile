# Shared base: all three stages need openssl (Prisma codegen in deps/builder, the
# Prisma CLI at runtime in runner). Installing it once here instead of three times
# saves ~30s a build and gives every stage an identical cacheable base layer.
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package*.json ./
COPY .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM base AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/scripts/repair-sqlite-schema.cjs ./scripts/repair-sqlite-schema.cjs
COPY --from=builder --chown=node:node /app/scripts/repair-sqlite-schema-lib.cjs ./scripts/repair-sqlite-schema-lib.cjs
# Merge pruned production node_modules so Prisma CLI gets hoisted peers (e.g. effect, c12) and full @prisma/*.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# The SQLite database lives here and is written by migrate deploy, the repair script and
# the app itself, so it must be owned by the runtime user. Declaring the mount point with
# the right owner up front means a fresh named volume inherits it instead of coming up
# root-owned and read-only to the app.
RUN mkdir -p /data && chown -R node:node /data /app

# Drop root: this process holds the finance database, and until now every part of the
# startup chain -- migrate deploy, the raw-SQL repair script, the Next server -- ran as
# uid 0. The base image ships an unprivileged `node` user for exactly this.
USER node

EXPOSE 3000
CMD ["sh", "-c", "set -e && ./node_modules/.bin/prisma migrate deploy && node scripts/repair-sqlite-schema.cjs && exec node server.js"]
