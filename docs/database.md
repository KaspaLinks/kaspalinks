# Database

Kaspa Links stores public links, creator settings, payment requests, audit events, claimable-link
state, and private operator aggregates in PostgreSQL through Prisma.

## Models

- `Action`: versioned public payment-action metadata
- `PaymentRequest`: payment request status and expiry state
- `AuditLog`: security-relevant and payment-relevant event records
- `Creator`: creator profile with username and hashed creator token
- `OperatorPageView`: private operator analytics page-view aggregate without raw IP storage

The schema intentionally does not include server-side wallet signing, custodial balances,
OAuth/passkey tables, password reset flows, or team permissions.

## Commands

Validate the Prisma schema:

```sh
pnpm db:validate
```

Generate the Prisma Client:

```sh
pnpm db:generate
```

Apply migrations to a configured PostgreSQL database:

```sh
pnpm db:migrate:deploy
```

Seed demo data into a configured PostgreSQL database:

```sh
pnpm db:seed
```

`db:generate` and `db:validate` use a safe placeholder `DATABASE_URL` if none is set because they do not connect to a live database. Migration and seed commands require a real PostgreSQL database URL.

## Notes

- Sompi values are stored as `BigInt` and serialized as decimal strings in API responses (see [action-metadata.md](./action-metadata.md)).
- The demo mock-confirm flow only runs when `MOCK_CONFIRM_ENABLED=true` is set on the server.
- Optional `txId` and `detectionSource` values support indexer-backed detection. The default
  deployment does not run a Kaspa node.
- Actions link to creators through optional `creatorId` and per-creator `slug` values.
  `/a/:publicId` remains valid when a human-readable `/u/:username/:slug` link exists.
- Creator deletes are soft deletes through `Action.deletedAt`. Payment requests and audit logs remain intact, and the slug stays reserved so an old public link cannot later point at a different recipient.
- Operator analytics stores deduplicated page views and daily visitor hashes so totals survive Caddy log rotation without adding cookies, third-party scripts, or raw IP storage.
