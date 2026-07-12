# Kaspa Links

Kaspa Links turns Kaspa payments into shareable links.

Create a URL or QR for a tip, donation, invoice, transfer, fundraising goal, creator profile, or
claimable Kaspa reward. Supporters can review the payment intent before opening a wallet, and funds
move wallet-to-wallet without custody.

> Kaspa Links never holds funds, never asks for seed phrases, and never stores wallet private keys.
> See [Security](./docs/security.md) for the complete trust model.

## Features

- Mobile-first public payment pages with QR, copy, Kaspium handoff, and KasWare support
- Tips, donations, invoices, transfers, and fundraising goals
- Public creator profiles with human-readable `/u/:username/:slug` links
- Creator dashboard, link management, receipts, conversion analytics, and supporter wall
- Claimable Kaspa links with one-time funding addresses, browser-side claim/refund signing, expiry,
  and server-authoritative on-chain status
- Branded social previews, downloadable QR codes, OBS overlay, embed helpers, and TypeScript SDK
- Optional Kaspa REST indexer integration for on-chain payment detection
- Self-hosted Docker Compose deployment with Caddy and PostgreSQL

## Non-Custodial Design

Normal payments go directly from the supporter wallet to the recipient wallet. Kaspa Links creates
and displays payment instructions but does not sign or forward those payments.

Claimable links lock KAS in a one-time on-chain script. Claim and refund keys remain in browser-only
URL fragments or encrypted local recovery data. Claim/refund transactions are signed in the browser;
the internal relay receives only already signed transaction JSON.

## Workspace

- `apps/web` - Next.js UI and API routes
- `packages/db` - Prisma schema, client, and seed
- `packages/kaspa` - Kaspa address, amount, URI, serialization, and Toccata helpers
- `packages/kaspa-indexer` - Kaspa REST indexer adapter
- `packages/wallet-adapter` - client-only KasWare integration
- `packages/sdk` - public TypeScript client
- `packages/embed-button` - dependency-free link and button helpers
- `deploy` - Caddy and database-backup configuration

## Development

Requirements: Node.js 22+, pnpm 11+, and PostgreSQL for database-backed flows.

```sh
pnpm install
pnpm dev
```

Useful commands:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:validate
pnpm db:generate
pnpm db:migrate:dev
pnpm db:migrate:deploy
pnpm db:seed
```

See [Local development](./docs/local-development.md) for environment and database setup.

## Main Routes

### Public

- `/` - product home
- `/try-it-out` - guided walkthrough
- `/u/:username` - public creator profile
- `/u/:username/:slug` - human-readable payment link
- `/a/:publicId` - stable payment-link fallback
- `/claim` - claimable Kaspa link
- `/overlay/:publicId` - OBS-compatible overlay
- `/stats` - public network activity summary
- `/faq` and `/roadmap` - product guidance and public roadmap

### Creator

- `/create-profile` and `/sign-in`
- `/my-profile`
- `/new-link`
- `/my-links`
- `/dashboard`

### Operator

- `/operator-stats` - private, Caddy-protected traffic overview
- `/admin` - token-protected administrative tools
- `/api/health` - JSON health probe

## Documentation

| Topic                       | File                                                           |
| --------------------------- | -------------------------------------------------------------- |
| Security model              | [docs/security.md](./docs/security.md)                         |
| Claimable links             | [docs/claimable-links.md](./docs/claimable-links.md)           |
| Public Action specification | [docs/public-action-spec.md](./docs/public-action-spec.md)     |
| API reference               | [docs/api.md](./docs/api.md)                                   |
| Creator tools               | [docs/creator-dashboard.md](./docs/creator-dashboard.md)       |
| Wallet compatibility        | [docs/wallet-compatibility.md](./docs/wallet-compatibility.md) |
| On-chain detection          | [docs/chain-detection.md](./docs/chain-detection.md)           |
| Operator analytics          | [docs/operator-analytics.md](./docs/operator-analytics.md)     |
| Deployment                  | [docs/deployment.md](./docs/deployment.md)                     |
| Local development           | [docs/local-development.md](./docs/local-development.md)       |
| Product scope               | [docs/product-scope.md](./docs/product-scope.md)               |

## Deployment

The supported deployment uses Docker Compose with Caddy as the only public ingress, an internal
Next.js app, an internal PostgreSQL database, and an internal claimable transaction relay.

Copy `.env.example` to `.env`, replace every placeholder, and never commit the resulting `.env`.
Then follow [Deployment](./docs/deployment.md).

## Community

- Website: [kaspalinks.com](https://kaspalinks.com)
- X: [@KaspaLinks](https://x.com/kaspalinks)
- Source: [github.com/KaspaLinks/kaspalinks](https://github.com/KaspaLinks/kaspalinks)

Kaspa Links is an independent community project and is not an official Kaspa product.
