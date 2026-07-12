# Community Demo Script

The goal: demonstrate the Kaspa Action concept end-to-end in under 60 seconds. Frame the project as **infrastructure**, not as another donation page clone.

## Prep checklist

- A deployment running with `MOCK_CONFIRM_ENABLED=true` (demo only — turn this back off in production).
- A seeded `demo-action` (or any action you create up front via `/admin`).
- Optional: creator signup enabled and a creator token saved if you want to demo `/dashboard` and `/u/:username/:slug`.
- A mobile device or a desktop browser with a narrow viewport (e.g. 390×844).
- Your `ADMIN_ACCESS_TOKEN` on hand for `/admin`.
- The site reachable at a stable URL.

## Talk track (about 60 seconds)

> "Kaspa Actions is a payment-action layer for Kaspa. Think 'shareable payment intents' — a creator tip, an invoice, a campaign — that any website, app, or overlay can drop in. It is non-custodial: we never hold funds, never see private keys."

Open `/a/demo-action` on the mobile viewport.

> "This is a public Action page. You see the title, the amount in KAS, the recipient address, and a clear non-custodial disclaimer. Everything is mobile-first."

Tap **Generate payment request**.

> "Now the app creates a 15-minute payment request, generates a `kaspa:` payment URI, and renders a QR code. From here, a supporter scans with their Kaspa wallet, or taps Open in wallet, or copies the address — they always pay directly, from their own wallet."

In another tab, open `/admin`. Paste the admin token. Use **Mock-confirm** on the payment request you just created.

> "Because this is a demo, I am mocking the confirmation. If indexer detection is enabled, the same status endpoint can also flip from an indexer-reported on-chain match. Notice the original page is polling — it picks up the new status without a refresh."

Switch back to the Action page.

> "Status: CONFIRMED. The audit log captured the relevant state changes. The OBS overlay can show
> the same public Action and optional request status without holding funds."

## What to avoid saying

- "This is a payment processor." It is not.
- "This is guaranteed final settlement." The recipient wallet remains the source of truth; mock-confirm is demo-only and indexer status is indexer-reported.
- "We hold the funds." We do not.
- "Sign in with your wallet." KasWare connect can show account/network status and open KasWare's own send confirmation, but Kaspa Actions never sees keys or signs server-side.

## Reset between demos

Use `/admin` to disable any test Actions you created, or just delete payment requests via the database if you have access. The `demo-action` itself is fine to leave in place.

## Variants

- **Tip flow:** create a `kaspa.tip` Action for the speaker before the demo, then show how a viewer would tip.
- **Creator dashboard flow:** open `/dashboard`, create a creator-owned Action, copy the `/u/:username/:slug` link, then run the normal mobile payment flow.
- **Invoice flow:** create a `kaspa.invoice` with a stronger title and a clear amount, focus on the "you pay this exact thing" framing.
- **Embed pitch:** after the demo, open `docs/embed.md` and show the one-line HTML snippet, then point at the SDK, wallet adapter, and OBS overlay docs.
