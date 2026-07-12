# Local Development

This guide gets you from a fresh clone to a running dev server.

## Prerequisites

- **Node.js 24+** — the project is tested against `node:24-bookworm-slim`.
- **pnpm 11** — enable via `corepack enable && corepack prepare pnpm@11.1.1 --activate`.
- **PostgreSQL** for non-stub development. The Docker Compose stack provides one; alternatively, a local PostgreSQL instance works.

The project is a pnpm workspace:

- `apps/web` — Next.js App Router app.
- `packages/db` — Prisma schema, client, seed.
- `packages/embed-button` — link-only embed button helpers for external websites.
- `packages/kaspa` — Kaspa helpers (SDK-backed address validation, KAS/sompi conversion, payment URI, QR payload, BigInt serializer).
- `packages/sdk` — public TypeScript client for Action metadata and PaymentRequest APIs.
- `packages/shared` — small shared constants.
- `packages/wallet-adapter` — client-only KasWare detection/connect helpers.

## Install

```sh
pnpm install
```

## Environment

Create a local `.env` (not committed) at the repo root. The minimum to run the dev server with a local PostgreSQL:

```sh
DATABASE_URL=postgresql://kaspa_actions:change-me@localhost:5432/kaspa_actions?schema=public
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
MOCK_CONFIRM_ENABLED=true
ADMIN_ACCESS_TOKEN=dev-admin-token
CREATOR_SIGNUP_ENABLED=true
CREATOR_ACTION_DAILY_LIMIT=50
```

`MOCK_CONFIRM_ENABLED` defaults to `false` when the variable is unset, even in development. Set it to `true` only when you intentionally want the demo confirmation flow.

`CREATOR_SIGNUP_ENABLED` defaults to `true` in development when unset and `false` in production when unset. Set it explicitly while testing creator signup so local behavior matches your intent.

## Database

The fastest path is to use the Docker Compose stack for PostgreSQL only:

```sh
docker compose up -d postgres
```

Then generate the Prisma client and apply migrations:

```sh
pnpm db:generate
pnpm db:migrate:deploy
pnpm db:seed   # optional: inserts the demo Action used by the landing page
```

For ad-hoc inspection:

```sh
docker exec -it kaspa-actions-postgres-1 psql -U kaspa_actions -d kaspa_actions
```

## Run the dev server

```sh
pnpm dev
```

Open `http://localhost:3000`. The seed creates a `demo-action` you can hit at `/a/demo-action`.

## Common scripts

| Command                  | Purpose                                          |
| ------------------------ | ------------------------------------------------ |
| `pnpm dev`               | Start Next.js in dev mode.                       |
| `pnpm build`             | Production build (also runs `pnpm db:generate`). |
| `pnpm start`             | Run the production build.                        |
| `pnpm test`              | Run Vitest.                                      |
| `pnpm lint`              | Run ESLint (`--max-warnings=0`).                 |
| `pnpm typecheck`         | Project-wide TypeScript check.                   |
| `pnpm db:generate`       | Regenerate Prisma client.                        |
| `pnpm db:migrate:dev`    | Create a new migration during development.       |
| `pnpm db:migrate:deploy` | Apply pending migrations.                        |
| `pnpm db:seed`           | Seed the demo Action.                            |
| `pnpm db:validate`       | Validate `schema.prisma`.                        |
| `pnpm format`            | Prettier check.                                  |
| `pnpm format:write`      | Prettier write.                                  |

## Testing rules of thumb

- Reset the in-memory rate limiter between tests (`resetRateLimits()` in `apps/web/src/lib/rate-limit.ts`).
- Avoid flaky timing tests; prefer injecting `now` into the limiter.
- Helpers in `apps/web/src/lib/*` and `packages/kaspa/src/*` are the easiest to test in isolation — Prisma is intentionally not mocked in route tests; smoke-test routes against the live Docker stack.

## Editor / format

The repo ships `.editorconfig`, `.prettierrc.json`, and `eslint.config.mjs`. Most modern editors pick these up automatically. There is no separate Husky / lint-staged setup; CI (or your fingers) runs `pnpm lint && pnpm typecheck && pnpm test`.

## Troubleshooting

- **`DATABASE_URL is required to create the Prisma client.`** — Make sure `.env` is loaded. `pnpm dev` picks up the repo-root `.env` automatically. For one-off scripts, run them with `DATABASE_URL=...` in front.
- **Next.js "Failed to collect page data" during build** — Caused by importing `prisma` at module top level in routes that get statically analyzed. The client is already lazy (`packages/db/src/client.ts`); if you see this error, check that you have not bypassed the Proxy.
- **Prisma openssl warning** — Harmless on `node:24-bookworm-slim`. Install `openssl` in the container if it bothers you (`apt-get install -y openssl`). The deployment Dockerfile already does this.
