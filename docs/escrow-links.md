# Escrow Links — Phase 1 UI Prototype

Status: frontend prototype with mock data. Nothing sends KAS, creates a
transaction, or writes to the database. The V1 covenant and offline TypeScript builder exist; wallet and network integration are still missing.

## Idea

Buyer and seller agree on a deal wherever they already trade (a marketplace
chat, Telegram, X). The seller creates an escrow link for that deal and shares
it. The buyer pays into a Kaspa covenant. Kaspa Links provides the interface; it
never holds KAS or keys and never decides who gets paid.

There is no catalog, search, messaging or rating system. Shipping addresses are
exchanged where the deal was agreed, not through Kaspa Links.

## Escrow model the screens assume

V1 has no deposits. The buyer funds one covenant output with the payment plus a fee reserve. The UI uses simulated amounts before network fees; a real fee reserve remains unmeasured. The release window is simulated from payment in this mock UI; real transactions must use the absolute DAA deadline committed before funding.

| Path    | Who signs | Condition                   | Result                                                    |
| ------- | --------- | --------------------------- | --------------------------------------------------------- |
| Release | Buyer     | ACTIVE                      | Payment to seller                                         |
| Refund  | Seller    | ACTIVE or FROZEN            | Payment to buyer; frozen refund deducts the remaining fee |
| Claim   | Seller    | ACTIVE, at/after deadline   | Payment to seller                                         |
| Freeze  | Buyer     | ACTIVE, even after deadline | Payment moves into FROZEN, spending one fee               |
| Settle  | Both      | FROZEN                      | Jointly signed split, accounting for the remaining fee    |

After the deadline, claim and freeze race. A frozen deal can remain locked indefinitely without joint settlement or seller refund. KaspaLinks never arbitrates a dispute.

The UI uses the same canonical lifecycle names intended for persistence:
`draft`, `awaiting_buyer`, `awaiting_funding`, `active`, `frozen`,
`released`, `refunded`, `claimed`, `settled`, `cancelled_unfunded`, and
`unknown_spend`. Shipping is metadata on an active deal, not a covenant state.
`claimed` means that the seller signed and broadcast the claim after the deadline;
it is not an automatic release.

## Routes

- `/escrow`: explainer, example deals, and the creator's escrow links when signed in
- `/escrow/new`: create form (existing creator sign-in), local photo previews, live preview
- `/escrow/[id]`: deal page with timeline, amounts, rules and role-specific next step
- `/toccata-lab/passkey-signer`: private PRF/passkey capability probe for the
  allowlisted creator; it derives and displays only a local public signer identity

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

- Passkey PRF stability across browser restarts, synced devices and credential providers
- Timelock source (DAA score), fees, compute budget and minimum outputs
- Link expiry when no buyer funds the prepared covenant
- Where shipment and freeze notes live, and who can read them
- Wallet support for multi-input covenant spends
- Legal review of the escrow link flow before any public launch
