# API Reference

All routes are Next.js Route Handlers under `apps/web/src/app/api/`. Responses are JSON, use `Cache-Control: no-store`, and follow a consistent error shape:

```json
{ "error": { "code": "ERROR_CODE", "message": "..." } }
```

Sompi amounts are always serialized as decimal strings to preserve precision.

For TypeScript consumers, the public endpoints can also be called through [Developer SDK](./developer-sdk.md).

## Conventions

- Admin routes require `Authorization: Bearer <ADMIN_ACCESS_TOKEN>`. Tokens are compared with `node:crypto.timingSafeEqual` after SHA-256 digesting, and unequal lengths are rejected before comparison.
- Creator routes require `x-creator-token: <CREATOR_TOKEN>` plus `x-creator-username: <username>`. `Authorization: Bearer <CREATOR_TOKEN>` is also accepted for API clients, but the browser UI uses `x-creator-token` so it still works when a deployment is protected by site-wide HTTP Basic Auth. Creator tokens are stored as hashes only.
- Mutation endpoints are rate-limited. Public/IP-facing routes use a SHA-256-hashed client IP;
  authenticated creator mutation routes may use the creator id instead. The current limits live in
  `apps/web/src/lib/rate-limit-helpers.ts`.
- Failed admin/creator attempts and security-relevant events are written to `AuditLog`. Submitted tokens, secrets, and seed phrases are never logged.

## Public endpoints

### `GET /api/health`

Liveness probe used by the Docker healthcheck and by external monitoring.

```sh
curl -s https://example.com/api/health
# {"commit":"2acd548","service":"kaspa-actions","status":"ok","version":"0.1.0"}
```

### `GET /api/price/kas-usd`

Returns the current approximate KAS/USD price used for display-only USD estimates in the UI.
The server fetches CoinGecko's public simple price endpoint and caches the result for a short
period, so browsers do not call CoinGecko directly. The KAS payment amount remains canonical;
USD is never written into payment URIs.

```sh
curl -s https://example.com/api/price/kas-usd
# {"price":{"kasUsd":"0.034","source":"coingecko","approximate":true,...}}
```

Errors:

- `503 PRICE_UNAVAILABLE`

### `GET /api/actions/:publicId`

Returns the public Action metadata. See [Public Kaspa Action Specification](./public-action-spec.md) and [Action metadata (v1)](./action-metadata.md).

```sh
curl -s https://example.com/api/actions/demo-action
```

Errors:

- `404 NOT_FOUND`
- `403 ACTION_DISABLED`
- `410 ACTION_EXPIRED`

### `POST /api/actions/:publicId/payment-requests`

Creates a `PaymentRequest` that is valid for 15 minutes. The request body is optional; when present it may include:

- `requestedMessage` — string ≤ 280 chars.
- `amountKas` — only meaningful for **variable-amount Actions**. When the parent Action has a fixed price this field is ignored. Use it so a supporter can lock in their chosen amount before paying.

```sh
curl -s -X POST https://example.com/api/actions/demo-action/payment-requests \
  -H 'content-type: application/json' \
  -d '{"requestedMessage": "Payment demo"}'
```

Returns `201 Created` with a `paymentRequest` object (see [Action metadata](./action-metadata.md) for amount serialization rules).

Errors:

- `400 INVALID_BODY`
- `403 ACTION_DISABLED`
- `404 NOT_FOUND`
- `410 ACTION_EXPIRED`
- `429 RATE_LIMITED`

### `GET /api/payment-requests/:id/status`

Returns the current payment request. The endpoint runs **lazy expiry**: if the request is still `PENDING` past its `expiresAt`, it is transitioned to `EXPIRED` and an audit log entry is written before the response is returned.

If `KASPA_INDEXER_ENABLED=true` is set on the server, the endpoint additionally asks the configured Kaspa REST indexer whether the recipient address has received an accepted transaction with the expected amount inside the request window. A match flips the request to `CONFIRMED` with a real `txId` and a `detectionSource` of the indexer's provider id. See [chain-detection.md](./chain-detection.md).

```sh
curl -s https://example.com/api/payment-requests/<id>/status
```

Errors:

- `404 NOT_FOUND`

## Creator endpoints

Creator endpoints handle normal creator-owned link management. They do not require the global admin
token, but they only return or mutate Actions owned by the authenticated creator.

### `POST /api/creators`

Creates a creator profile when `CREATOR_SIGNUP_ENABLED=true`. The response includes the plaintext creator token once; save it immediately because only its hash is stored.

```sh
curl -s -X POST https://example.com/api/creators \
  -H 'content-type: application/json' \
  -d '{"username":"ada","displayName":"Ada"}'
```

Errors:

- `400 INVALID_BODY`
- `403 CREATOR_SIGNUP_DISABLED`
- `409 USERNAME_TAKEN`
- `429 RATE_LIMITED`

### `POST /api/creators/login`

Verifies a username and creator token.

```sh
curl -s -X POST https://example.com/api/creators/login \
  -H 'content-type: application/json' \
  -d '{"username":"ada","token":"ka_creator_..."}'
```

Errors:

- `400 INVALID_BODY`
- `401 CREATOR_TOKEN_INVALID`
- `429 RATE_LIMITED`

### `DELETE /api/creators/me`

Permanently deletes the authenticated creator profile, every owned Action, and every
`PaymentRequest` attached to those Actions. The body must repeat the signed-in username as an
intent confirmation step.

Security audit records remain for abuse investigation, but their creator/action/payment-request
foreign keys are cleared by database `SetNull` rules once the owned rows are removed.

```sh
curl -s -X DELETE https://example.com/api/creators/me \
  -H "x-creator-token: $CREATOR_TOKEN" \
  -H "x-creator-username: ada" \
  -H 'content-type: application/json' \
  -d '{"confirmUsername":"ada"}'
```

Errors:

- `400 INVALID_BODY`
- `401 CREATOR_TOKEN_REQUIRED` / `CREATOR_TOKEN_INVALID`
- `429 RATE_LIMITED`

### `GET /api/creator/actions`

Lists Actions owned by the authenticated creator.

```sh
curl -s https://example.com/api/creator/actions \
  -H "x-creator-token: $CREATOR_TOKEN" \
  -H "x-creator-username: ada"
```

Errors:

- `401 CREATOR_TOKEN_REQUIRED` / `CREATOR_TOKEN_INVALID`

### `POST /api/creator/actions`

Creates a creator-owned Action with a per-creator slug. Public links are available at both `/a/:publicId` and `/u/:username/:slug`. New Actions are mainnet-only. `kaspa.invoice` and `kaspa.transfer` require a fixed amount; `kaspa.tip` and `kaspa.donation` may remain variable-amount.

```sh
curl -s -X POST https://example.com/api/creator/actions \
  -H "x-creator-token: $CREATOR_TOKEN" \
  -H "x-creator-username: ada" \
  -H 'content-type: application/json' \
  -d '{
    "type": "kaspa.tip",
    "slug": "tip-jar",
    "title": "Tip Ada",
    "amountKas": "10",
    "network": "mainnet",
    "recipientAddress": "kaspa:..."
  }'
```

Errors:

- `400 INVALID_BODY`
- `401 CREATOR_TOKEN_REQUIRED` / `CREATOR_TOKEN_INVALID`
- `409 SLUG_TAKEN`
- `429 RATE_LIMITED`

### `GET /api/creator/action-payments`

Returns payment summaries for every Action owned by the authenticated creator in one request. The
server deduplicates identical `(network, recipientAddress)` pairs before it talks to the indexer, so
links that reuse one wallet address do not trigger duplicate chain scans. Each Action still receives
its own post-creation view: receipts older than that Action's `createdAt` are excluded before totals
are returned.

```sh
curl -s https://example.com/api/creator/action-payments \
  -H "x-creator-token: $CREATOR_TOKEN" \
  -H "x-creator-username: ada"
```

Errors:

- `401 CREATOR_TOKEN_REQUIRED` / `CREATOR_TOKEN_INVALID`

### `PATCH /api/creator/actions/:publicId`

Disables or re-enables a creator-owned Action.

```sh
curl -s -X PATCH https://example.com/api/creator/actions/<publicId> \
  -H "x-creator-token: $CREATOR_TOKEN" \
  -H "x-creator-username: ada" \
  -H 'content-type: application/json' \
  -d '{"disabled":true}'
```

Errors:

- `400 INVALID_BODY`
- `401 CREATOR_TOKEN_REQUIRED` / `CREATOR_TOKEN_INVALID`
- `404 NOT_FOUND`

### `DELETE /api/creator/actions/:publicId`

Soft-deletes a creator-owned Action. The Action disappears from `/dashboard`, public `/u/:username/:slug` and `/a/:publicId` routes return `404`, and payment/audit history remains in the database.

```sh
curl -s -X DELETE https://example.com/api/creator/actions/<publicId> \
  -H "x-creator-token: $CREATOR_TOKEN" \
  -H "x-creator-username: ada"
```

Errors:

- `401 CREATOR_TOKEN_REQUIRED` / `CREATOR_TOKEN_INVALID`
- `404 NOT_FOUND`

## Admin endpoints

### `POST /api/admin/actions`

Creates an Action. Required body fields: `type`, `title`, `recipientAddress`. New Actions are mainnet-only. The amount is optional for `kaspa.tip` and `kaspa.donation`; pass **at most one** of `amountKas` / `amountSompi` to fix a price, or omit both for a variable-amount Action ("pay what you want"). `kaspa.invoice` and `kaspa.transfer` require a fixed amount. Optional: `description`, `message`, `network` (defaults to `mainnet` and currently accepts only `mainnet`), `expiresAt` (ISO-8601).

```sh
curl -s -X POST https://example.com/api/admin/actions \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{
    "type": "kaspa.tip",
    "title": "Tip Ada 10 KAS",
    "amountKas": "10",
    "network": "mainnet",
    "recipientAddress": "kaspa:..."
  }'
```

Returns `201 Created` with `{ "action": { "id", "publicId", "type", "amountSompi", "createdAt" } }`.

Errors:

- `400 INVALID_BODY`
- `401 ADMIN_TOKEN_REQUIRED` / `ADMIN_TOKEN_INVALID`
- `429 RATE_LIMITED`
- `503 ADMIN_DISABLED` (when `ADMIN_ACCESS_TOKEN` is not configured)

### `PATCH /api/admin/actions/:publicId`

Updates an existing Action. Any combination of `title`, `description`, `message`, `expiresAt`, or `disabled` may be passed. Setting `disabled: true` records an `action.disabled` audit event; `false` records `action.enabled`.

```sh
curl -s -X PATCH https://example.com/api/admin/actions/demo-action \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{ "disabled": true }'
```

Errors:

- `400 INVALID_BODY`
- `401 ADMIN_TOKEN_REQUIRED` / `ADMIN_TOKEN_INVALID`
- `404 NOT_FOUND`
- `429 RATE_LIMITED`

### `POST /api/admin/payment-requests/:id/mock-confirm`

Mock-confirms a `PaymentRequest`. **Only available when `MOCK_CONFIRM_ENABLED=true` is set on the server.** When disabled the route returns `403 MOCK_CONFIRM_DISABLED` and writes a `mock_confirm.attempted_while_disabled` audit log.

State transitions are guarded server-side:

- `PENDING → CONFIRMED` — sets `confirmedAt` and generates a `fakeTxId`.
- Already `CONFIRMED`, `EXPIRED`, or `FAILED` → `409 INVALID_STATE`.
- `PENDING` past its `expiresAt` → lazy-expires first, then `409`.

```sh
curl -s -X POST https://example.com/api/admin/payment-requests/<id>/mock-confirm \
  -H "authorization: Bearer $ADMIN_ACCESS_TOKEN"
```

Errors:

- `401 ADMIN_TOKEN_REQUIRED` / `ADMIN_TOKEN_INVALID`
- `403 MOCK_CONFIRM_DISABLED`
- `404 NOT_FOUND`
- `409 INVALID_STATE`
- `429 RATE_LIMITED`

## Error codes

| Code                      | Typical status | Meaning                                         |
| ------------------------- | -------------- | ----------------------------------------------- |
| `INVALID_BODY`            | 400            | Zod validation failed.                          |
| `ADMIN_TOKEN_REQUIRED`    | 401            | Bearer token missing.                           |
| `ADMIN_TOKEN_INVALID`     | 401            | Bearer token did not match.                     |
| `CREATOR_TOKEN_REQUIRED`  | 401            | Creator username or creator token missing.      |
| `CREATOR_TOKEN_INVALID`   | 401            | Creator token did not match.                    |
| `ACTION_DISABLED`         | 403            | Action was disabled by an admin.                |
| `CREATOR_SIGNUP_DISABLED` | 403            | Creator signup is disabled on this deployment.  |
| `MOCK_CONFIRM_DISABLED`   | 403            | Server has `MOCK_CONFIRM_ENABLED=false`.        |
| `NOT_FOUND`               | 404            | Resource missing.                               |
| `ACTION_EXPIRED`          | 410            | Action `expiresAt` is in the past.              |
| `INVALID_STATE`           | 409            | PaymentRequest cannot transition.               |
| `USERNAME_TAKEN`          | 409            | Creator username already exists.                |
| `SLUG_TAKEN`              | 409            | Creator already used that Action slug.          |
| `RATE_LIMITED`            | 429            | Per-IP-hash bucket exceeded.                    |
| `ADMIN_DISABLED`          | 503            | `ADMIN_ACCESS_TOKEN` not set in the deployment. |
| `PRICE_UNAVAILABLE`       | 503            | KAS/USD price lookup temporarily failed.        |
| `SERVER_ERROR`            | 500            | Unexpected error. Stack traces are not exposed. |

## Audit events

`AuditLog` captures security- and payment-relevant events. See [security.md](./security.md) for the full list and metadata sanitization rules.
