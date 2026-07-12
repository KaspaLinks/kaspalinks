# Repository Guidelines

## Product

Kaspa Links turns Kaspa payments into shareable links. It is mobile-first and non-custodial.

Supported public link experiences include tips, donations, invoices, transfers, fundraising goals,
creator profiles, and claimable Kaspa links. The product should remain simple enough to understand
before a wallet opens.

## Non-Custodial Requirements

These rules are absolute:

- Never store or log private keys, seed phrases, wallet credentials, claim keys, or refund keys.
- Never ask users for seed phrases or wallet private keys.
- Never hold, pool, forward, or rebalance user funds.
- Normal payments go directly from the supporter wallet to the recipient address.
- Wallet signing stays inside the user's wallet.
- Claimable-link claim and refund transactions are signed in the browser.
- The claimable relay may receive only already signed transaction JSON.
- Do not add trading, swapping, staking, lending, leverage, or investment features.

## Stack

- TypeScript and pnpm workspaces
- Next.js App Router and Route Handlers
- Prisma and PostgreSQL
- Zod and Vitest
- Docker Compose and Caddy
- Vendored Kaspa WASM SDK

Do not introduce a separate Express/Fastify service, tRPC, Redis, hosted databases, external
authentication, analytics, tracking, or payment processors without an explicit product decision.

## Architecture

- `apps/web`: UI, public pages, creator tools, and HTTP APIs
- `packages/db`: Prisma schema and database client
- `packages/kaspa`: address, amount, URI, serialization, and Toccata helpers
- `packages/kaspa-indexer`: on-chain read adapter
- `packages/wallet-adapter`: browser-only KasWare integration
- `packages/sdk`: public TypeScript client
- `packages/embed-button`: dependency-free embed helpers
- `deploy`: Caddy and backup configuration

## Security

- Validate request bodies, params, and query strings with Zod.
- Use the shared JSON error shape: `{ "error": { "code": "...", "message": "..." } }`.
- Rate-limit public and mutation endpoints.
- Trust forwarded client IPs only when the app is reachable exclusively through the configured
  Caddy proxy.
- Do not add broad CORS headers or `Access-Control-Allow-Origin: *`.
- Keep PostgreSQL, the Next.js app, and the claimable relay private to the Docker network.
- Compare admin and creator authentication material safely.
- Store browser authentication in `sessionStorage`, never URLs, cookies, or `localStorage`.
- Do not log authorization headers, full request bodies, tokens, or wallet material.
- Render user content as escaped text and never with `dangerouslySetInnerHTML`.
- Preserve audit logs for security- and payment-relevant events without secret metadata.

## Kaspa Rules

- Validate addresses with the vendored Kaspa SDK.
- Use string parsing and integer/BigInt arithmetic for KAS and sompi.
- `1 KAS = 100,000,000 sompi`.
- Reject zero, negative, scientific-notation, non-numeric, and over-precision amounts.
- Serialize sompi and database BigInt values as strings in JSON.
- Build payment URIs from validated fields and safely encoded query parameters.
- Keep claimable-link funding, claim, refund, expiry, fee, and script checks consistent between
  browser, API, database, indexer, and relay boundaries.

## Creator Data

- Creator tokens are shown once and stored only as hashes.
- Usernames and public slugs follow `^[a-z0-9][a-z0-9_-]{2,29}$`.
- Titles, descriptions, wallet messages, and supporter messages are trimmed, length-limited, and
  rendered as plain text.
- Creator APIs may return or mutate only resources owned by the authenticated creator.
- Public metadata must not contain internal secrets or private recovery material.

## UI

- Keep pages mobile-first, fast, and accessible.
- Use the existing visual system, icons, controls, spacing, and responsive breakpoints.
- Payment pages must clearly show title, type, amount, recipient, optional message, status, QR/copy
  actions, wallet handoff, and non-custodial guidance.
- Users must be able to verify payment intent before opening a wallet.
- Claimable links must clearly distinguish available, claimed, expired/refundable, refunded, and
  unknown-spend states.
- Avoid feature-description text inside operational interfaces when the control can explain itself.

## Deployment

- Target self-hosted Docker Compose with Caddy, Next.js, PostgreSQL, and the internal claimable
  relay.
- Never copy `.env`, SSH keys, credentials, or wallet material into images or source control.
- Caddy is the only public ingress.
- Use health checks and preserve database/log volumes.
- Set `APP_COMMIT_SHA` for deployed builds.

## Testing and Delivery

- Add or update focused tests for changed helpers, validation, state transitions, security checks,
  serialization, wallet handoffs, and claimable-link behavior.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before release.
- Avoid flaky tests and reset in-memory limiter state between tests.
- Keep changes focused and compatible with existing public URLs and stored records.
- Summarize changed files, commands, tests, and any residual operational verification after each
  task.
