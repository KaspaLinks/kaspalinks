# Deployment

This guide describes how to self-host Kaspa Actions on a Hetzner VPS (or any Linux host with Docker) using Docker Compose.

The deployment runs a non-custodial payment-link layer with optional indexer-backed on-chain
detection and a client-only KasWare send bridge. Normal payment links never require server signing,
server broadcasting, or custody. Claimable links sign claim/refund transactions in the browser and
relay only already signed transaction JSON through an internal wRPC service.

## Services

- `caddy`: public reverse proxy, exposes ports `80`, `443`, and `443/udp`
- `app`: internal Next.js standalone server, exposed only inside the Docker network
- `toccata-relay`: internal wRPC relay for claimable-link broadcasts, exposed only inside the Docker network
- `postgres`: internal PostgreSQL database, stored in a Docker volume, not publicly exposed

## First-Time VPS Setup

1. Point the domain DNS `A` and/or `AAAA` records at the VPS IP address.
2. Install Docker and Docker Compose on the VPS.
3. Clone or copy this repository to the VPS.
4. Copy `.env.example` to `.env`.
5. Change every placeholder value in `.env` before starting the stack.
6. Run:

```sh
APP_COMMIT_SHA="$(git rev-parse --short HEAD)" docker compose up -d --build
```

7. Check status:

```sh
docker compose ps
docker compose logs -f caddy app postgres
```

8. Verify the health endpoint:

```sh
curl https://your-domain.example/api/health
```

## Required Secret Changes

Before deployment, change at least:

- `DOMAIN`
- `NEXT_PUBLIC_APP_URL`
- `ACME_EMAIL`
- `BASIC_AUTH_HASH` while the closed-beta Basic Auth gate remains in `deploy/Caddyfile`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`, keeping it consistent with the PostgreSQL values
- `ADMIN_ACCESS_TOKEN`

Do not use the placeholder passwords or admin token from `.env.example` on a real VPS.

The current `deploy/Caddyfile` ships with a closed-beta HTTP Basic Auth gate in front of the
entire site. Generate a bcrypt hash with `caddy hash-password --plaintext '...'`, store it as
`BASIC_AUTH_HASH` in `.env`, and keep the hash single-quoted there so Docker Compose preserves
the `$` characters inside the bcrypt value. When the project goes public, remove the `basic_auth`
block from `deploy/Caddyfile` and restart Caddy deliberately instead of leaving a shared beta
password in place.

Never commit `.env`, SSH keys, Hetzner credentials, wallet credentials, private keys, or seed phrases.

## Network Notes

Only Caddy should be reachable from the internet. The Next.js app and PostgreSQL services are internal Docker services.

Do not expose PostgreSQL ports publicly.

Do not publish the app container port directly. Caddy should be the only public entrypoint.

## Operational Notes

- The full Action API surface is documented in [api.md](./api.md).
- Set `APP_COMMIT_SHA` during deploy so `/api/health` and the site footer show the exact live build.
- `MOCK_CONFIRM_ENABLED` defaults to `false`. Leave it `false` in production; the mock-confirm endpoint is for demos only.
- `ADMIN_ACCESS_TOKEN` is required for admin mutation routes. If unset, those routes refuse writes with `503 ADMIN_DISABLED`.
- `CREATOR_SIGNUP_ENABLED` defaults to `false` in production. Turn it on only while you intentionally accept new creator profiles.
- `CREATOR_ACTION_DAILY_LIMIT` defaults to `50` and caps creator-owned Action creation per creator over a rolling 24-hour window.
- `/operator-stats` reads rolling Caddy access logs from `OPERATOR_ACCESS_LOG_DIR`, deduplicates
  page views, and stores them in PostgreSQL. It is meant for the site operator only; keep it behind
  Basic Auth or another private gate. See [operator-analytics.md](./operator-analytics.md).
- The in-memory rate limiter resets on container restart and does not coordinate across instances.
  The supported deployment runs a single app instance.
- The app container does not run a Kaspa node. Optional indexer-backed detection uses the configured REST indexer. Normal payment-link wallet signing/broadcasting happens inside the user's wallet.
- `TOCCATA_LAB_ENABLED` defaults to `false`. Turn it on only when you intentionally want to offer claimable links. The flow is mainnet-only, starts at 1 KAS, signs claim/refund spends in the browser, and relays signed JSON only after an explicit user action.
- `TOCCATA_WRPC_RELAY_URL` should point at the internal `toccata-relay` service (`http://toccata-relay:3010` in Docker Compose). The relay keeps a reusable Kaspa wRPC client, warms the connection on startup/health checks, retries warm connection attempts every `TOCCATA_RELAY_WARM_CONNECT_INTERVAL_MS`, and is not published through Caddy.

## Database Migrations

Prisma migrations live under `packages/db/prisma/migrations`.

Apply migrations against the running PostgreSQL container with a real `DATABASE_URL`:

```sh
pnpm db:migrate:deploy
```

Optional: seed the demo Action so the landing page has something to link to:

```sh
pnpm db:seed
```

Automatic migration execution inside Docker Compose is not wired up; run migrations deliberately
during deployment.
