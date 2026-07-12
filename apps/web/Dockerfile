# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/embed-button/package.json ./packages/embed-button/package.json
COPY packages/kaspa/package.json ./packages/kaspa/package.json
COPY packages/kaspa-indexer/package.json ./packages/kaspa-indexer/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/wallet-adapter/package.json ./packages/wallet-adapter/package.json
COPY vendor/kaspa-wasm-v2.0.1 ./vendor/kaspa-wasm-v2.0.1

RUN pnpm install --frozen-lockfile

FROM deps AS builder

COPY . .

RUN pnpm db:generate && pnpm --filter @kaspa-actions/web build

FROM node:24-bookworm-slim AS wrpc-relay

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3010

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs relay

COPY --from=deps --chown=relay:nodejs /app/node_modules/.pnpm/kaspa-wasm@file+vendor+kaspa-wasm-v2.0.1/node_modules/kaspa-wasm ./node_modules/kaspa-wasm
COPY --chown=relay:nodejs apps/wrpc-relay/server.mjs ./apps/wrpc-relay/server.mjs

USER relay

EXPOSE 3010

CMD ["node", "apps/wrpc-relay/server.mjs"]

FROM node:24-bookworm-slim AS runner

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/server/chunks/kaspa_bg.wasm ./apps/web/.next/server/chunks/kaspa_bg.wasm
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/server/vendor-chunks/kaspa_bg.wasm ./apps/web/.next/server/vendor-chunks/kaspa_bg.wasm
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/kaspa-wasm@file+vendor+kaspa-wasm-v2.0.1/node_modules/kaspa-wasm ./node_modules/kaspa-wasm

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
