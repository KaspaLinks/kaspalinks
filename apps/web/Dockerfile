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
COPY apps/agent-worker/package.json ./apps/agent-worker/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/agent/package.json ./packages/agent/package.json
COPY packages/application/package.json ./packages/application/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/embed-button/package.json ./packages/embed-button/package.json
COPY packages/kaspa/package.json ./packages/kaspa/package.json
COPY packages/kaspa-indexer/package.json ./packages/kaspa-indexer/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/wallet-adapter/package.json ./packages/wallet-adapter/package.json
COPY vendor/kaspa-wasm-v2.0.1 ./vendor/kaspa-wasm-v2.0.1

RUN pnpm install --frozen-lockfile

FROM deps AS agent-worker

ENV AGENT_WORKER_ENABLED=false
ENV NODE_ENV=production

COPY . .

RUN pnpm db:generate \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs agent

USER agent

CMD ["./node_modules/.bin/tsx", "apps/agent-worker/src/index.ts"]

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
COPY --chown=relay:nodejs apps/wrpc-relay/protocol.mjs ./apps/wrpc-relay/protocol.mjs

USER relay

EXPOSE 3010

CMD ["node", "apps/wrpc-relay/server.mjs"]

FROM debian:bookworm-slim AS silverscript

ARG TARGETARCH=amd64

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) \
      archive="silverc-linux-x86_64.tar.gz"; \
      checksum="058ffa17a390526f27280752f864b1bd680217cded14dfc5b7fd168d7e943fb5" ;; \
    arm64) \
      archive="silverc-linux-arm64.tar.gz"; \
      checksum="6f8cf9a1eaf2904fa75c1b1ff85a1803a4d4939325de00431b6b05e20854083f" ;; \
    *) echo "unsupported SilverScript target architecture: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/kaspanet/silverscript/releases/download/v1.0.0/${archive}" -o /tmp/silverc.tar.gz; \
  echo "${checksum}  /tmp/silverc.tar.gz" | sha256sum -c -; \
  tar -xzf /tmp/silverc.tar.gz -C /tmp; \
  install -m 0755 /tmp/silverc /usr/local/bin/silverc

FROM node:24-bookworm-slim AS runner

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000
ENV SILVERC_BIN=/usr/local/bin/silverc
ENV SILVERSCRIPT_SOURCE_DIR=/app/labs/claimable-script

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
COPY --from=silverscript --chown=nextjs:nodejs /usr/local/bin/silverc /usr/local/bin/silverc
COPY --chown=nextjs:nodejs labs/claimable-script/giveaway_entry_shard_v6.sil ./labs/claimable-script/giveaway_entry_shard_v6.sil
COPY --chown=nextjs:nodejs labs/claimable-script/giveaway_prize_shards_v6.sil ./labs/claimable-script/giveaway_prize_shards_v6.sil

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
