# Public Kaspa Action Specification

Status: **v1 stable**

This document defines the public Action contract that external websites, embeds, wallets, overlays, and developer tools can rely on.

Kaspa Actions turns Kaspa payments into shareable actions. A public Action is a versioned, human-readable and machine-readable payment instruction. It is not a wallet and not custody.

The current hosted Kaspa Links product creates **mainnet-only** Actions. The v1 contract keeps the
`network` field for explicit chain identity and for compatibility with legacy or external metadata.

## Goals

- Make Kaspa payment intent clear before a user opens a wallet.
- Provide a stable JSON shape for public metadata.
- Let external apps link to, preview, and embed payment Actions.
- Keep payment flow non-custodial: supporter wallet pays recipient wallet directly.
- Preserve a clean migration path for future Action versions.

## Non-Goals

- No server-side transaction signing or broadcasting.
- No private-key or seed-phrase handling.
- No custodial balances.
- No fund forwarding.
- No trading, swapping, staking, lending, leverage, or investment features.
- No custodial wallet behavior, browser-extension project, or native mobile app behavior in v1.

## Resource Model

An Action has a stable public URL:

```text
https://example.com/a/:publicId
```

Creator-owned Actions may also expose a human-readable public URL:

```text
https://example.com/u/:username/:slug
```

An Action has public JSON metadata:

```text
GET https://example.com/api/actions/:publicId
```

The `publicId` identifies the Action for public consumers. Clients must treat it as an opaque string and must not infer database IDs, creator identity, or permissions from it. Human-readable creator links are aliases for the same public Action page; `/a/:publicId` remains the stable fallback.

## Versioning

The initial public schema version is:

```text
v1
```

Rules:

- Every public metadata response includes `version`.
- Breaking schema changes require a new version such as `v2`.
- Once implemented, `v1` must not silently change in a breaking way.
- Clients should ignore unknown fields to remain forward-compatible.
- Servers must not remove or change the meaning of existing `v1` fields.

## Supported v1 Action Types

Only these Action types are part of v1:

```text
kaspa.transfer
kaspa.tip
kaspa.donation
kaspa.invoice
```

Other types are outside v1 and must not be emitted as `v1` metadata.

## Public Metadata Envelope

`GET /api/actions/:publicId` returns:

```json
{
  "action": {
    "version": "v1",
    "type": "kaspa.tip",
    "title": "Tip Ada 10 KAS",
    "description": "Support this creator with a direct Kaspa payment.",
    "recipientAddress": "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
    "amountSompi": "1000000000",
    "amountKas": "10",
    "message": "Thanks for the guide",
    "expiresAt": null,
    "publicId": "demo-action",
    "network": "mainnet"
  }
}
```

## Field Rules

| Field              | Type             | Required | Rule                                                                                                            |
| ------------------ | ---------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `version`          | `string`         | Yes      | Always `"v1"` for this specification.                                                                           |
| `type`             | `string`         | Yes      | One of the supported v1 Action types.                                                                           |
| `title`            | `string`         | Yes      | Human-readable title, trimmed, max 80 characters.                                                               |
| `description`      | `string \| null` | Yes      | Optional description, trimmed, max 280 characters.                                                              |
| `recipientAddress` | `string`         | Yes      | SDK-validated Kaspa address. Hosted Kaspa Links creation APIs currently accept `kaspa:` mainnet addresses only. |
| `amountSompi`      | `string \| null` | Yes      | Positive integer sompi amount serialized as a decimal string. `null` means variable amount.                     |
| `amountKas`        | `string \| null` | Yes      | Display amount derived from `amountSompi`, or `null` for variable amount Actions.                               |
| `message`          | `string \| null` | Yes      | Optional user-facing message, trimmed, max 280 characters.                                                      |
| `expiresAt`        | `string \| null` | Yes      | ISO-8601 UTC timestamp or `null`.                                                                               |
| `publicId`         | `string`         | Yes      | Stable public Action identifier.                                                                                |
| `network`          | `string`         | Yes      | Explicit chain id. Hosted Kaspa Links creation APIs currently emit `"mainnet"` only.                            |

## Amount Rules

- `1 KAS = 100,000,000 sompi`.
- `amountSompi` is the canonical amount when fixed.
- `amountSompi` must be serialized as a string when set, never as a JSON number.
- `amountSompi: null` and `amountKas: null` mean the supporter chooses the amount for that PaymentRequest.
- Clients should parse `amountSompi` with `BigInt` or a decimal-safe library.
- `amountKas` is for display and is derived from `amountSompi`.
- Scientific notation, negative values, zero, `NaN`, and `Infinity` are invalid.
- More than 8 decimal places is invalid when accepting a KAS amount string.

## Address and Network Rules

- The v1 schema can identify `kaspa:` and `kaspatest:` addresses.
- Hosted Kaspa Links creation APIs currently accept only `kaspa:` / `mainnet`.
- When other v1 metadata is encountered, `network` must still match the address prefix:
  - `kaspa:` -> `mainnet`
  - `kaspatest:` -> `testnet`
- Address validation uses the Kaspa WASM SDK parser in the current implementation.
- Clients must still ask users to verify recipient addresses in their wallet.

## Payment URI

The public Action page and PaymentRequest APIs may expose a conservative `kaspa:` payment URI.

Rules:

- The URI points directly to `recipientAddress`.
- The amount is included only after safe integer conversion.
- Labels and messages must be URL-encoded.
- Private data must not be embedded in the URI.
- The URI is a payment instruction, not proof of payment.

Example:

```text
kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j?amount=10&label=Demo%20Kaspa%20Action
```

## PaymentRequest Lifecycle

An Action can create PaymentRequests:

```text
POST /api/actions/:publicId/payment-requests
```

PaymentRequests are short-lived execution attempts for an Action.

Statuses:

```text
PENDING
CONFIRMED
EXPIRED
FAILED
```

Allowed transitions:

```text
PENDING -> CONFIRMED
PENDING -> EXPIRED
PENDING -> FAILED
```

Forbidden transitions:

```text
EXPIRED -> CONFIRMED
CONFIRMED -> CONFIRMED
FAILED -> CONFIRMED
EXPIRED -> PENDING
CONFIRMED -> PENDING
FAILED -> PENDING
```

Protocol rules:

- PaymentRequests expire after 15 minutes.
- Status is polled by the frontend every 3 seconds.
- Expiry happens lazily on `GET /api/payment-requests/:id/status`.
- Confirmation may come from demo mock-confirm or optional indexer-backed detection depending on deployment configuration.
- Mock confirmation must never be described as an on-chain confirmation.
- Indexer-backed confirmation means the configured indexer reported a matching accepted transaction; the recipient wallet remains the source of truth.

## Error Shape

All public API errors use:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

Common public errors:

| HTTP status | Code              | Meaning                                   |
| ----------- | ----------------- | ----------------------------------------- |
| `400`       | `INVALID_BODY`    | Request body or params failed validation. |
| `403`       | `ACTION_DISABLED` | Action was disabled.                      |
| `404`       | `NOT_FOUND`       | Action or PaymentRequest does not exist.  |
| `410`       | `ACTION_EXPIRED`  | Action is expired.                        |
| `409`       | `INVALID_STATE`   | PaymentRequest transition is forbidden.   |
| `429`       | `RATE_LIMITED`    | Mutation rate limit was exceeded.         |

## Security Requirements

Public consumers and integrations must follow these rules:

- Render `title`, `description`, and `message` as escaped text only.
- Do not render user-generated Action fields as HTML.
- Do not use Action metadata as wallet authorization.
- Do not request private keys or seed phrases.
- Do not claim mock-confirm is real on-chain payment.
- Do not overstate indexer-backed status as a substitute for the recipient wallet.
- Do not use admin tokens in query strings.
- Do not log secrets, Authorization headers, wallet credentials, seed phrases, or private keys.

## Caching

Current implementation returns `Cache-Control: no-store` for public API responses. A future version may permit short-lived caching for stable public metadata, but disabled/expired Actions and PaymentRequest status must remain accurate.

## Integration Guidance

Recommended integrations for v1:

- Link to `/a/:publicId`.
- Use `GET /api/actions/:publicId` to preview title, amount, network, and recipient address.
- Use the link-only `@kaspa-actions/embed-button` helpers for website buttons.
- Use `@kaspa-actions/sdk` for typed public metadata and PaymentRequest calls.
- Use `@kaspa-actions/wallet-adapter` only for client-side wallet presence, account, network checks, and explicit user-approved KasWare sends.
- Let the hosted Action page handle QR, copy, open-wallet, and status polling.

Not recommended in v1:

- Rebuilding payment-state logic in third-party clients.
- Bypassing the hosted Action page for users who need clear address verification.
- Presenting mock status as real chain confirmation.
- Presenting indexer-reported status as guaranteed final settlement.

## Future Versions

Future versions may define additional Action types or capabilities, such as:

- operator-owned node/indexer mirrors
- richer wallet integrations
- stream overlays
- claimable links
- split Actions
- pay-to-unlock Actions
- membership Actions
- covenant-based expiry/refund flows after hardfork stability

Those features must use explicit future work and must not change the meaning of v1.
