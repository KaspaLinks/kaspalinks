# Action Metadata (v1)

This document describes the public Action metadata format that `GET /api/actions/:publicId` returns. The broader public contract is defined in [Public Kaspa Action Specification](./public-action-spec.md).

## Stability

- The `v1` shape is stable. If the schema changes in a breaking way, a new version (`v2`, ...) is added; `v1` keeps responding to existing consumers.
- The public v1 metadata format covers the supported transfer-style Action types. New incompatible
  formats must use a new version.

## Response shape

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

## Fields

| Field              | Type             | Notes                                                                                                                                     |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `version`          | `string`         | Always `"v1"` for this schema.                                                                                                            |
| `type`             | `string`         | One of `kaspa.transfer`, `kaspa.tip`, `kaspa.donation`, `kaspa.invoice`.                                                                  |
| `title`            | `string`         | Human-readable, trimmed, up to 80 chars.                                                                                                  |
| `description`      | `string \| null` | Optional, trimmed, up to 280 chars.                                                                                                       |
| `recipientAddress` | `string`         | Validated Kaspa address. The hosted Kaspa Links product currently creates only `kaspa:` mainnet Actions.                                  |
| `amountSompi`      | `string \| null` | BigInt as decimal string. **`null` = variable-amount Action** — supporter picks the amount in their wallet. `1 KAS = 100_000_000 sompi`.  |
| `amountKas`        | `string \| null` | Human display of `amountSompi`. `null` mirrors variable-amount Actions.                                                                   |
| `message`          | `string \| null` | Optional, trimmed, up to 280 chars. Always rendered as escaped text.                                                                      |
| `expiresAt`        | `string \| null` | ISO-8601 datetime in UTC, or `null` if the Action does not expire.                                                                        |
| `publicId`         | `string`         | Stable, shareable identifier in URLs (`/a/:publicId`).                                                                                    |
| `network`          | `string`         | `"mainnet"` for newly created Actions in the hosted product. Legacy or external v1 metadata may still identify another supported network. |

## BigInt handling

- `amountSompi` is a decimal string when set. Never parse it as a JavaScript `Number` — values above `Number.MAX_SAFE_INTEGER` will lose precision. Use `BigInt(...)` or a decimal library.
- `amountKas` is derived from `amountSompi` server-side using integer math and trimmed of trailing zeros.
- **Variable-amount Actions**: when both fields are `null`, the supporter sets the amount in their own wallet. The generated `kaspa:`-URI omits the `amount=` parameter. Wallets accept this and let the user enter any value. Best fit for tips and donations; not suitable for invoices.

## Error responses

All error responses share this shape:

```json
{
  "error": {
    "code": "ACTION_DISABLED",
    "message": "Action is disabled."
  }
}
```

For this endpoint:

- `404 NOT_FOUND` — no Action with that `publicId`.
- `403 ACTION_DISABLED` — the Action was disabled by an admin.
- `410 ACTION_EXPIRED` — the Action's `expiresAt` is in the past.

## Caching

Responses currently set `Cache-Control: no-store` to keep status/expiry checks honest. A future revision may switch to short-lived caching for stable public metadata.

## What it is not

- The metadata is not an instruction to a server-side wallet. Kaspa Links is non-custodial; the
  response is purely informational.
- The metadata is not a confirmation that funds were received. Use the PaymentRequest status endpoint for that. Depending on deployment configuration, status may come from demo mock-confirm or opt-in indexer-backed on-chain detection.
