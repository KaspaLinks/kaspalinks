# Escrow Links — Phase 1 UI Prototype

Status: frontend prototype with mock data. Nothing sends KAS, creates a
transaction, or writes to the database. The covenant will be specified
separately before any funds move.

## Idea

Buyer and seller agree on a deal wherever they already trade (a marketplace
chat, Telegram, X). The seller creates an escrow link for that deal and shares
it. The buyer pays into a Kaspa covenant. Kaspa Links provides the interface; it
never holds KAS or keys and never decides who gets paid.

There is no catalog, search, messaging or rating system. Shipping addresses are
exchanged where the deal was agreed, not through Kaspa Links.

## Escrow model the screens assume

Both sides lock the same deposit (0 %, 25 %, 50 % or 100 % of price plus
shipping) on top of the deal. The seller chooses a release window of 7, 14 or 30
days, counted from payment.

| Path        | Who signs            | When                       | Payout                                          |
| ----------- | -------------------- | -------------------------- | ----------------------------------------------- |
| Release     | Buyer                | Any time while funded      | Seller: item total + deposit. Buyer: deposit    |
| Refund      | Seller               | Any time while funded      | Buyer: item total + deposit. Seller: deposit    |
| Claim       | Seller               | After the release deadline | Same as release                                 |
| Freeze      | Buyer                | Any time while funded      | Nothing moves; the escrow becomes frozen        |
| Settle      | Buyer **and** seller | While frozen               | Any split that adds up to the full locked total |
| Cancel link | Seller               | Before the buyer pays      | Seller deposit returns                          |

The covenant cannot cap the freeze in time (see
[escrow-covenant-v1.md](./escrow-covenant-v1.md)), so after the deadline claiming and
freezing race each other. The seller should claim promptly.

Freezing prevents either side from taking the KAS alone. Deposits make holding
out expensive for both sides; they do not guarantee an honest outcome. The
escrow cannot verify a parcel or judge a dispute, and the UI copy says so.

## Routes

- `/escrow`: explainer, example deals, and the creator's escrow links when signed in
- `/escrow/new`: create form (existing creator sign-in), local photo previews, live preview
- `/escrow/[id]`: deal page with timeline, amounts, rules and role-specific next step

The deal page has prototype controls to switch between buyer and seller, jump
between example deals, and skip past the release deadline.

## Access

The prototype is visible only to allowlisted creators:

- `app/escrow/layout.tsx` returns 404 unless `ESCROW_LINKS_PROTOTYPE_ENABLED=true`
  (on by default outside production).
- `GET /api/creator/escrow-access` verifies the creator session and answers 200
  only for usernames in `ESCROW_LINKS_PROTOTYPE_CREATORS` (comma-separated), 404
  otherwise.
- Every escrow page is wrapped in `EscrowAccessGate`. Signed-out visitors and other
  creators see the regular "not found" page; nothing escrow-related is rendered
  on the server, and the server title stays neutral.
- Allowlisted creators get an "Escrow link" template on `/new-link`.
- All routes are `noindex`.

## Code

- `app/escrow/_lib`: types, bigint amount helpers, status/timeline/action rules,
  a pure transition function, draft validation, fixtures, feature flag
- `app/escrow/_components`: shared escrow UI built on the existing `card`,
  `btn`, `status-pill`, `type-segmented`, `preview-card` and `amount-display`
  styles
- `app/escrow/escrow.css`: escrow-prefixed styles loaded only by the escrow layout

KAS amounts use `bigint` sompi and the existing `@kaspa-actions/kaspa/amount`
helpers. USD values reuse the live KAS price estimate and stay secondary.

## Open questions before Phase 2

- Covenant design: two-party funding (seller deposit and buyer payment), the
  frozen state transition, timelock source (DAA score), fees and minimum outputs
- Whether a 0 % deposit option should exist at all
- Link expiry when no buyer pays, and how the seller reclaims the deposit
- Where shipment and freeze notes live, and who can read them
- Wallet support for multi-input covenant spends
- Legal review of the escrow link flow before any public launch
