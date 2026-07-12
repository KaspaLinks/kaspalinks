# Creator Dashboard and Human Links

Kaspa Links provides a lightweight creator-owned link flow without requiring email accounts,
passwords, or custody. Dedicated routes keep each creator workflow focused.

Creators can:

- create a creator profile at `/create-profile` when `CREATOR_SIGNUP_ENABLED=true`
- receive a one-time creator token (shown only once, must be saved immediately)
- sign in with username + token at `/sign-in`
- see a cockpit at `/dashboard` — total received KAS, payment count, active links of total, average per payment, and a recent-activity feed of on-chain receipts deduplicated by transaction id
- manage the public profile at `/my-profile` — display name, bio, profile QR download, quick-tip card selection, and profile deletion
- delete the creator profile from `/my-profile` when they want to leave; profile, owned links, and related payment requests are removed, while security audit records remain for abuse investigation
- create new links at `/new-link` — type radio-cards (Tip / Donation / Invoice / Transfer), auto-suggested slug from the title, live preview card that mirrors the public link page, inline mainnet address validation, sticky submit on mobile
- use the public profile immediately after onboarding — the first visible active link is promoted to the large Quick-tip card automatically, and later links can still be selected manually from `/my-profile`
- review every link they own at `/my-links` — each card shows status (Active / Disabled), recipient address with copy, public URL with copy, QR downloads, total KAS received + payment count from the indexer, recent receipts with explorer links, plus Enable / Disable / Delete actions
- jump straight into a public link page with `/u/<username>/<slug>` or the opaque fallback `/a/<publicId>`

Old opaque links such as `/a/cmp5a4n3p000101k3jjef5v36` still work and remain the stable
fallback for every link.

## Security Model

Creator tokens are intentionally simple:

- generated server-side with a `ka_creator_` prefix
- shown only once after signup
- stored as SHA-256 hashes in PostgreSQL
- not readable or recoverable later because the plaintext token is never stored
- compared with `node:crypto.timingSafeEqual`
- stored in `sessionStorage` by the dashboard
- never stored in `localStorage`, cookies, URLs, logs, or audit metadata
- the brand-bar pill (`Signed in as <username>`) reads the same `sessionStorage` key so a sign-out from the dropdown menu propagates across `/dashboard`, `/my-links`, `/new-link` instantly via a custom `kaspa-actions:session` event plus the native cross-tab `storage` event

There is no email login, OAuth, passkey login, wallet-signature login, password reset, token
rotation, or team management.

## Environment

`CREATOR_SIGNUP_ENABLED` is the deployment kill switch.

- In production, signup defaults to disabled when unset.
- In development, signup defaults to enabled when unset.
- Set `CREATOR_SIGNUP_ENABLED=true` only when new creator signup should be open.

`CREATOR_ACTION_DAILY_LIMIT` caps creator-owned link creation per creator over a rolling 24-hour
window. It defaults to `50` and is capped at `500`.

## Routes (UI)

| Route             | Auth state | Job                                                                                                     |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| `/sign-in`        | signed out | Username + token form. Redirects to `/my-links` on success.                                             |
| `/create-profile` | signed out | Username + display-name form. Issues the one-time creator token.                                        |
| `/dashboard`      | signed in  | Metrics + recent activity. CTAs for creating links, managing links, and opening profile settings.       |
| `/my-profile`     | signed in  | Public profile settings, profile QR downloads, quick-tip card picker, and profile deletion danger zone. |
| `/new-link`       | signed in  | Focused creation form.                                                                                  |
| `/my-links`       | signed in  | List of every owned link with full details.                                                             |
| `/u/:u/:slug`     | public     | Public link page using the human-readable URL.                                                          |
| `/a/:publicId`    | public     | Public link page using the opaque id (stable, never changes).                                           |

Visitors hitting a signed-in-only route while signed out see a small chooser card that points at
`/sign-in` and `/create-profile`. The brand-bar shows a "Sign in" pill when signed out and a
"Signed in as <username>" pill plus a hamburger dropdown with Sign out when signed in.

## API Surface

- `POST /api/creators` creates a creator profile when signup is enabled.
- `POST /api/creators/login` verifies username + creator token.
- `DELETE /api/creators/me` permanently deletes the authenticated creator profile and owned data.
- `GET /api/creator/actions` lists Actions owned by the authenticated creator.
- `POST /api/creator/actions` creates a creator-owned Action with a slug.
- `PATCH /api/creator/actions/:publicId` disables or re-enables one creator-owned Action.
- `DELETE /api/creator/actions/:publicId` soft-deletes one creator-owned Action.
- `GET /api/profiles/:username/qr?format=svg&size=1024` renders a profile URL QR image.
- `GET /api/actions/:publicId/qr?format=png&size=1024` renders a public link URL QR image.
- `GET /api/creator/action-payments` returns recent incoming payments for all owned Actions in one
  request, deduplicated server-side by network + recipient address.
- `GET /api/creator/actions/:publicId/payments` still lists recent incoming payments for one
  Action's recipient address when the relevant indexer is enabled.

Creator API requests use:

```text
x-creator-token: <CREATOR_TOKEN>
x-creator-username: <username>
```

Creator APIs never return or mutate Actions owned by another creator.

Deleting a creator profile is intentionally destructive: the creator row, owned Actions, and their
PaymentRequests are hard-deleted. Security AuditLog rows remain, with foreign keys cleared by
database `SetNull` rules, so operators keep an abuse-investigation trail without keeping the
deleted creator profile alive.

The payment scan is still address-based, but each Action only receives receipts at or after its own
`createdAt`. If several links point at the same wallet, one address scan is reused server-side and
then trimmed per Action before it reaches the dashboard. The dashboard still deduplicates by
`transactionId + outputIndex` before aggregating, so a single on-chain receipt counts once across
all of the creator's metrics even when N links share that address.

## Link Uniqueness

Creator usernames are globally unique. Action slugs are unique per creator. That means the full
public URL `/u/:username/:slug` cannot be created twice.

Deleted links keep their slug reserved so old public URLs cannot later point to a different
recipient by accident.

This does not prove a public figure's real-world identity. For well-known creators, keep public
signup closed or use manual/invite-based onboarding until creator verification exists.
