# Wallet Adapter

The client-only wallet adapter provides a KasWare connection panel and an explicit
**Pay with KasWare** button on public Action pages.

This integration follows the KasWare browser-extension model documented at:

- https://docs.kasware.xyz/wallet/developer-documentation/kaspa
- https://docs.kasware.xyz/wallet/dev-base/kaspa

## What It Does

- Detects an injected `window.kasware` provider.
- Requests accounts only after the user presses **Connect KasWare**.
- Reads the selected account, network, and balance when available.
- Shows whether the wallet network matches the Action network.
- Listens for account, network, and balance changes when the provider exposes events.
- Forwards fixed-amount PaymentRequests to `kasware.sendKaspa()` only after the user presses **Pay with KasWare** and the wallet network matches the Action network.
- For claimable-link development, detects KasWare's `signPskt` capability and can run explicit signing-surface probes. Current KasWare builds expect Transaction SafeJSON on that surface, not the internal PSKT wrapper JSON.

## What It Does Not Do

- It does not sign transactions itself.
- It does not broadcast transactions directly; KasWare handles signing and broadcast after its own confirmation dialog.
- It does not ask for seed phrases.
- It does not ask for private keys.
- It does not send wallet data to the server.
- It does not replace QR / copy / open-wallet URI flows.
- Wallet signing probes do not create a claimable link, do not fund the derived address, and do not broadcast anything.

The public Action page still uses the same non-custodial payment instruction flow. The wallet adapter helps users verify the selected wallet account/network and can ask KasWare to send directly from the user's wallet to the recipient address.

## Package

The workspace package is:

```ts
import {
  connectKaswareWallet,
  getKaswareProvider,
  readKaswareAccounts,
  readKaswareBalance,
  readKaswareNetwork,
  sendKaspaPayment,
} from "@kaspa-actions/wallet-adapter";
```

The package has no runtime dependencies and does not use admin tokens.

## Safety Rule

Do not add transaction signing outside KasWare or the reviewed claimable-link browser flow, KRC20 signing, private-key handling, or seed-phrase handling without an explicit task request and a new security review.
