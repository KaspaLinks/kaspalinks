# Product Scope and Limitations

Kaspa Links is a non-custodial payment-link layer for Kaspa. It makes payment intent easy to
review, share, and open in a wallet without becoming a wallet or payment custodian.

## Included

- Tips, donations, invoices, transfers, fundraising goals, and claimable Kaspa links
- Mobile-first public pages with QR, copy, wallet handoff, and status display
- Creator profiles, link management, receipts, analytics, and public supporter messages
- Browser-only KasWare integration and mobile wallet URI handoff
- Optional indexer-backed on-chain detection
- Self-hosted Docker Compose deployment

## Explicitly Excluded

- Custodial balances or fund forwarding
- Server-held wallet keys, claim keys, refund keys, or seed phrases
- Server-side transaction signing
- Trading, swapping, lending, leverage, staking, or investment products
- OAuth, email/password accounts, password reset, or team permissions
- Fiat and card payment processing

## Known Constraints

- The supported deployment runs one app instance and uses an in-memory rate limiter.
- Payment detection depends on configured indexer availability; the recipient wallet remains the
  source of truth.
- USD values are estimates. KAS and sompi remain the authoritative payment amounts.
- Creator authentication uses a one-time token that users must save. There is no token-recovery
  service.
- Normal payment attribution is address-, amount-, and time-based. A dedicated recipient address
  is recommended where exact accounting matters.
- Claimable links rely on browser-held recovery material. Losing the private refund link can make
  an unclaimed output unrecoverable by the creator.
- Kaspa Links is an independent community project, not an official Kaspa wallet or product.

## Design Boundary

Features belong in this repository when they make Kaspa payment intent clearer or easier to share
without introducing custody. Public future work is described on the in-app `/roadmap` page.
