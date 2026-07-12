# Security Notes

This document captures the security-relevant rules enforced by Kaspa Links. If the code deviates
from these rules, treat it as a security bug.

## Non-custodial model

The product is non-custodial. The server never:

- stores private keys,
- asks for seed phrases or wallet credentials,
- signs transactions on behalf of users,
- broadcasts real transactions for normal payment links; claimable-link claim/refund transactions
  are signed in the browser and the relay forwards already signed transaction JSON without
  receiving keys,
- holds, forwards, or rebalances user funds.

Supporters always pay from their own wallet directly to the recipient address. The server's role is limited to metadata, payment-instruction generation, and status display. When the client uses **Pay with KasWare**, KasWare itself shows the confirmation dialog, signs, and broadcasts inside the user's wallet. For claimable links, claim/refund codes stay browser-side, and the relay only handles already signed SafeJSON.

Claimable-link registration does not trust a browser-supplied funding script. The server rebuilds the
canonical script and funding address from the public claim key, public refund key, and refund lock
time, then requires an exact match. The same reconstruction runs again before signed transaction JSON
can reach the relay.

Claim links keep a compact private claim key in the URL fragment after `#`. Fragment decoding,
public-key derivation, and the equality check against the registered public claim key happen
client-side. The fragment is never included in an application API request or access log.

## Admin authentication

Admin mutation routes (`POST /api/admin/actions`, `PATCH /api/admin/actions/:publicId`, `POST /api/admin/payment-requests/:id/mock-confirm`) require:

- `x-admin-token: <ADMIN_ACCESS_TOKEN>` from the browser admin UI, or
- `Authorization: Bearer <ADMIN_ACCESS_TOKEN>` for CLI/API clients.
- The header is parsed and the presented token is SHA-256 digested before being compared with `node:crypto.timingSafeEqual`.
- Unequal lengths are rejected before `timingSafeEqual` (which would otherwise throw).
- A failed admin attempt creates an `AuditLog` entry with `actorType=ADMIN` and a `reason` field. The submitted token is **never** logged.

If `ADMIN_ACCESS_TOKEN` is unset in production, admin mutation routes respond with `503 ADMIN_DISABLED` and refuse writes.

### Admin token storage in the demo UI

`/admin` accepts the token in a single input and stores it in `sessionStorage` only:

- not in `localStorage`,
- not in cookies,
- cleared automatically when the tab closes,
- never sent over query parameters.

Operators should treat the token like a password: rotate it on any suspected leak (`docker compose down && edit .env && docker compose up -d`) and never paste it on a shared device.

## Operator perimeter

The public site is reachable without a shared password. The private `/operator-stats` dashboard
stays behind Caddy HTTP Basic Auth. `deploy/Caddyfile` reads the bcrypt hash from
`BASIC_AUTH_HASH` in `.env`; the hash should stay single-quoted in `.env` so Docker Compose
preserves its `$` characters.

That perimeter is separate from application auth:

- the browser admin UI sends `x-admin-token` first,
- creator browser flows send `x-creator-token`,
- `Authorization: Bearer ...` remains available as a fallback for CLI/API clients.

The custom headers deliberately take priority so creator/admin auth does not depend on Caddy's
operator-only password.

## Creator authentication

Creator management routes use lightweight creator-token authentication:

- `x-creator-token: <CREATOR_TOKEN>` in the browser UI
- `Authorization: Bearer <CREATOR_TOKEN>` remains accepted for API clients
- `x-creator-username: <username>`

Creator tokens are generated once, shown once after signup, hashed before storage, and compared through fixed-length SHA-256 digests with `node:crypto.timingSafeEqual`. Failed creator login and guard attempts are audit-logged without logging the submitted token or raw Authorization header.

The `/dashboard` UI stores the creator token in `sessionStorage` only:

- not in `localStorage`,
- not in cookies,
- never in query parameters,
- cleared automatically when the tab closes.

Creator APIs only list, create, disable, re-enable, delete owned Actions, or delete the creator's
own profile where `creatorId` matches the authenticated creator. Profile deletion hard-deletes the
creator row, owned Actions, and related PaymentRequests; security AuditLog rows remain with
database foreign keys cleared so abuse investigations still have an event trail.

## Rate limiting

`apps/web/src/lib/rate-limit.ts` is an in-memory token-bucket limiter. Public/IP-facing routes use
a SHA-256-hashed client IP; authenticated creator mutation routes can key by creator id instead.
The current rules:

| Bucket                   | Limit | Window |
| ------------------------ | ----- | ------ |
| `admin.mutation`         | 30    | 60 s   |
| `creator.signup`         | 5     | 60 min |
| `creator.login`          | 10    | 60 s   |
| `creator.action.create`  | 20    | 60 s   |
| `creator.profile.delete` | 5     | 60 s   |
| `payment-request.create` | 20    | 60 s   |
| `payment-request.status` | 120   | 60 s   |
| `mock.confirm`           | 30    | 60 s   |

Creator-owned Action creation also has a rolling 24-hour per-creator cap controlled by `CREATOR_ACTION_DAILY_LIMIT` (default `50`, maximum `500`).

This is intentionally simple. The supported deployment runs one app instance; a future
multi-instance deployment needs a shared limiter. The current limiter resets on restart and in tests.

When the app is behind Caddy (the recommended setup), `X-Forwarded-For` is parsed for the client IP. The app container is not directly exposed to the internet.

## Audit log

`AuditLog` records security- and payment-relevant events. Each entry contains:

- `event` — short machine-readable name (e.g. `action.created`, `payment_request.lazy_expired`).
- `actorType` — `SYSTEM`, `ADMIN`, `PUBLIC`, `CREATOR`, or `DEMO`.
- `metadata` — JSON, sanitized by `sanitizeAuditMetadata` to strip forbidden keys.
- `ipHash` — SHA-256-hashed client IP, never the raw IP.
- `actionId` / `paymentRequestId` — optional foreign keys.
- `createdAt` — timestamp.

The sanitizer removes any metadata key in this list:

```
accessToken, adminToken, authorization, body, key, password,
privateKey, rawBody, secret, seedPhrase, token, walletKey
```

If every key is forbidden, `metadata` is stored as `NULL` rather than as an empty object.

### Events emitted

| Event                                   | When                                                        | Actor     |
| --------------------------------------- | ----------------------------------------------------------- | --------- |
| `action.created`                        | Admin creates an Action.                                    | `ADMIN`   |
| `action.updated`                        | Admin patches non-disabled fields.                          | `ADMIN`   |
| `action.disabled`                       | Admin sets `disabled: true`.                                | `ADMIN`   |
| `action.enabled`                        | Admin sets `disabled: false`.                               | `ADMIN`   |
| `action.public_metadata_disabled`       | Public GET on a disabled action.                            | `PUBLIC`  |
| `action.public_metadata_expired`        | Public GET on an expired action.                            | `PUBLIC`  |
| `payment_request.created`               | Public POST creates a PaymentRequest.                       | `PUBLIC`  |
| `payment_request.lazy_expired`          | GET status flips PENDING → EXPIRED.                         | `SYSTEM`  |
| `payment_request.chain_confirmed`       | Indexer match flips PENDING → CONFIRMED with a real `txId`. | `SYSTEM`  |
| `payment_request.mock_confirmed`        | Mock-confirm succeeds.                                      | `ADMIN`   |
| `mock_confirm.attempted_while_disabled` | Mock-confirm hit while flag is off.                         | `ADMIN`   |
| `mock_confirm.invalid_state_transition` | Mock-confirm on a non-PENDING request.                      | `ADMIN`   |
| `admin.create_action_unauthorized`      | Failed admin token on create.                               | `ADMIN`   |
| `admin.update_action_unauthorized`      | Failed admin token on update.                               | `ADMIN`   |
| `admin.mock_confirm_unauthorized`       | Failed admin token on mock-confirm.                         | `ADMIN`   |
| `creator.created`                       | Creator profile created.                                    | `CREATOR` |
| `creator.signup_disabled`               | Signup attempted while disabled.                            | `CREATOR` |
| `creator.login_succeeded`               | Creator login succeeded.                                    | `CREATOR` |
| `creator.login_failed`                  | Creator login failed.                                       | `CREATOR` |
| `creator.auth_failed`                   | Creator API guard rejected credentials.                     | `CREATOR` |
| `creator.action_created`                | Creator created an owned Action.                            | `CREATOR` |
| `creator.action_disabled`               | Creator disabled an owned Action.                           | `CREATOR` |
| `creator.action_enabled`                | Creator re-enabled an owned Action.                         | `CREATOR` |
| `creator.action_deleted`                | Creator soft-deleted an owned Action.                       | `CREATOR` |
| `creator.action_daily_limit_exceeded`   | Creator hit the rolling daily creation cap.                 | `CREATOR` |
| `creator.delete_blocked_open_claimable` | Profile deletion blocked to preserve Claimable recovery.    | `CREATOR` |

## Input validation

All API request bodies, path params, and query params are validated with Zod. Validation failures return `400 INVALID_BODY` with a message that names the offending path. Internal stack traces are not exposed to the client.

User-generated content (titles, descriptions, messages, recipient addresses) is rendered as escaped text. `dangerouslySetInnerHTML` is not used anywhere for user content.

## Address validation

Address validation lives in `packages/kaspa/src/address.ts` and uses the vendored `rusty-kaspa v2.0.1` `kaspa-wasm` `Address` parser:

- rejects empty strings and whitespace,
- rejects malformed addresses and bad checksums,
- accepts only the supported `kaspa` and `kaspatest` prefixes,
- returns the normalized address string and network.

This is still validation only. It does not add wallet signing, transaction broadcasting, node access, indexer access, or custody.

Toccata covenant SDK readiness is checked separately in `packages/kaspa/src/toccata.ts`. Covenant features must not be enabled unless that capability gate passes in the runtime being used.

## Wallet Adapter

The wallet adapter is client-only:

- It detects the KasWare browser provider when present.
- It calls `requestAccounts` only after a user presses the connect button.
- It may read account, network, and balance data in the browser.
- It can call `sendKaspa` only from the explicit **Pay with KasWare** button after a PaymentRequest exists and the wallet network has been verified.
- It does not sign transactions itself, does not ask for private keys or seed phrases, and does not send wallet account/balance data to the server.

## Network exposure

The recommended Docker Compose layout exposes only Caddy publicly:

- Caddy listens on ports 80 and 443 and reverse-proxies to the app.
- The Next.js app container does not bind to a host port; it is reachable only through the `kaspa-actions_default` Docker network.
- PostgreSQL is internal to the same network with no host port mapping.
- Caddy sets `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`. CORS is not opened up.

## Logging

The app does not log full request bodies, admin tokens, or any secret. Run-time errors are surfaced via the standard Next.js / Node error reporting, and security-relevant signals go to `AuditLog`.

## Private operator analytics

`/operator-stats` is an operator-only dashboard backed by rolling Caddy access logs. It is not a
public product analytics feature and does not add tracking scripts, third-party analytics, cookies,
or user-facing visitor profiles.

The Docker deployment writes Caddy logs to a dedicated `caddy_logs` volume and mounts that volume
read-only into the app container. The dashboard reads recent log lines, stores deduplicated
page-view records in PostgreSQL, and shows aggregate counts only. Raw IP addresses are not
displayed or stored in the app database; the approximate unique-visitor metric uses a daily
IP/browser hash instead of raw IP data.

Caddy deletes `Authorization`, `Proxy-Authorization`, and `Cookie` request headers before writing
the access log. If the global closed-beta Basic Auth gate is removed for public launch,
`/operator-stats` must remain behind a separate operator-only auth gate.

The Caddyfile is Cloudflare-ready: it trusts the current Cloudflare IPv4/IPv6 edge ranges, enables
strict trusted-proxy parsing, and reads the real visitor IP from `CF-Connecting-IP` before
`X-Forwarded-For`. The analytics parser only accepts country headers when Caddy logged a distinct
trusted proxy IP and client IP, so direct-origin requests cannot create fake country dots just by
sending a forged `CF-IPCountry` header.

## Price estimates

The optional KAS/USD display uses a server-side request to CoinGecko's public simple price endpoint
and caches the result briefly in memory. Browsers call only the local `/api/price/kas-usd` route.
The price is display-only: payment URIs, PaymentRequests, and on-chain matching continue to use KAS
and sompi only.

## Secret handling

- `.env` is never committed.
- `.env.example` contains placeholders only.
- `ADMIN_ACCESS_TOKEN`, database password, and any other secret must be replaced before deploying. The README and `deployment.md` say so explicitly.

## Wallet send-flow (Pay with KasWare)

The public Action page can trigger a `kasware.sendKaspa(toAddress, sompi)` call when KasWare is connected. This is a thin, client-only forward and is **explicitly reviewed** here, since any wallet-signing feature requires an explicit security review.

What the bridge does:

- Reads `recipientAddress` and `amountSompi` straight from the server-rendered Action metadata (the same values the user already sees in the page).
- Compares the wallet's reported network with the Action's network and refuses to send on a mismatch.
- Forwards the two values to KasWare via the documented provider method.
- KasWare displays its own confirmation dialog. The user reviews and approves (or rejects) inside the wallet.
- On success the wallet returns a transaction id; the page surfaces it and waits for the indexer's confirmation.

What the bridge **never** does:

- It does not ask for or accept private keys, seed phrases, mnemonics, or passwords.
- It does not sign transactions itself; signing is entirely inside KasWare.
- It does not store, log, or transmit the user's wallet state to the Kaspa Actions server.
- It does not broadcast anything directly; KasWare's own signer broadcasts.
- It does not move funds through any server-controlled address; payments still go supporter → recipient.

Hard-coded safety rails in `packages/wallet-adapter/src/index.ts`:

- Refuses non-positive sompi amounts.
- Refuses amounts above `Number.MAX_SAFE_INTEGER` (the wallet bridge takes a JS number, so larger amounts would lose precision silently).
- Refuses recipient strings that are empty, whitespace-only, or contain inner whitespace.
- Wraps every failure (user rejection, missing method, unexpected response) in a typed `WalletAdapterError` without leaking internal messages.
- Only accepts hex-shaped transaction ids in the wallet's response.

Audit-log surface: the send itself is client-side and produces no server-side log entry. The downstream `payment_request.chain_confirmed` event (written when the indexer later observes the same tx) is the canonical record. Operators who need a tighter audit trail can add a server endpoint that accepts the returned tx id and records a `wallet.send_reported` event — that is out of scope for this revision.

## Reporting

If you find a security issue, do not open a public issue. Contact the operator of the deployment directly. For the upstream project, the maintainer's preferred channel will be added when the project moves to a public repository.
