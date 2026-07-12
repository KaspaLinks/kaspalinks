# Wallet Compatibility

This document tracks how the Kaspa Actions UI behaves with different wallets. It is a curated, dated list — not an exhaustive specification. The underlying primitives (`kaspa:` URI, QR code, copy-address) are open standards, so any wallet that supports them should work; this page records what we have actually seen working.

> **Methodology:** "Verified" means the operator opened a public Action URL on a real device or browser with the wallet installed, tapped/clicked the relevant button, and watched the wallet open with the correct address (and amount, when present). "Unverified but expected" means the wallet's documentation supports the primitive but we have not run the click-through ourselves.

## Mobile wallets (Open-in-Wallet button)

The Action page exposes an `Open in wallet (mobile)` link. The operating system routes the `kaspa:` URI scheme to whichever installed app has registered as a handler. For broad mobile compatibility, the launch URI intentionally includes only the recipient address and amount; wallet notes stay visible on the Kaspa Links page and in the copied fallback text because some mobile wallet builds reject richer query strings.

| Wallet                     | Platform     | Status                     | Notes                                                                                        |
| -------------------------- | ------------ | -------------------------- | -------------------------------------------------------------------------------------------- |
| **Kaspium**                | iOS, Android | ✅ Verified 2026-05-14     | Opens directly with prefilled recipient and amount. Use a mainnet wallet for `kaspa:` links. |
| **KasWare Mobile**         | iOS, Android | ⚠️ Unverified but expected | Mobile build should register the scheme. Please report if it works.                          |
| **Tangem (companion app)** | iOS, Android | ⚠️ Unverified but expected | Hardware wallet with mobile companion; companion app is expected to handle `kaspa:`.         |
| **OKX Wallet**             | iOS, Android | ⚠️ Unverified              | Multi-chain wallet, supports Kaspa, scheme registration unverified.                          |

## Desktop wallets (Pay-with-KasWare button)

The Action page exposes a `Pay with KasWare` button that calls the wallet's in-process `sendKaspa()` API directly. This bypasses the `kaspa:` link entirely, which is why the desktop flow does not depend on URL-scheme registration.

| Wallet             | Platform                        | Status                 | Notes                                                                                                       |
| ------------------ | ------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **KasWare Wallet** | Chrome / Brave / Edge extension | ✅ Verified 2026-05-13 | Wallet adapter reads accounts, network, and balance; `sendKaspa()` opens KasWare's own confirmation dialog. |
| **KSPR Wallet**    | Browser extension               | ⚠️ Unverified          | Different provider object; the adapter currently looks for `window.kasware` only.                           |

## Universal fallbacks

Every Action page also offers:

- **QR code** — uses the same conservative address + amount URI as the mobile deep-link.
- **Copy address / Copy amount / Copy URI** — works everywhere, even for users on platforms with no wallet integration.

## What does **not** work

- **Custodial exchange accounts** (Binance, MEXC, Coinbase, OKX exchange-side, etc.) — these are not wallets in the URL-scheme sense; users have to log in to the exchange website and paste address/amount manually.
- **Hardware wallets without a paired companion app** — Cold-storage devices that cannot register protocol handlers.
- **KasWare browser extension on desktop with the plain `kaspa:` link** — that's why the desktop flow uses the programmatic `sendKaspa()` call instead.

## How to add to this list

Tested another wallet successfully? Open a PR (or note it in the operator log) with:

- Wallet name and version.
- Platform (iOS x.y / Android x.y / Chrome x.y / etc.).
- What you tested (Open-in-Wallet, Pay-with-KasWare-equivalent, QR scan).
- Date of the test.

This page is meant to be useful at a glance; over-curate it, do not blindly mark wallets as "supported" without an actual click-through.
