# Embedding Kaspa Actions

Kaspa Links exposes shareable Action URLs and a small link-only embed button package for websites
that want generated button markup. Optional indexer-backed status and the client-only KasWare send
bridge remain handled by the hosted Action page.

Replace `https://example.com` with your deployment, and `demo-action` with the `publicId` of your Action. Creator-owned Actions can use the friendlier `/u/:username/:slug` URL instead.

## Direct link

The simplest possible embed. Works in any context that renders text or HTML.

```html
<a href="https://example.com/a/demo-action" rel="noopener" target="_blank"> Support with Kaspa </a>
```

For creator links:

```html
<a href="https://example.com/u/ada/tip-jar" rel="noopener" target="_blank"> Support with Kaspa </a>
```

## Inline button

A minimal styled button using inline CSS to avoid dependencies.

```html
<a
  href="https://example.com/a/demo-action"
  rel="noopener"
  target="_blank"
  style="display:inline-block;padding:10px 16px;border-radius:8px;background:#14a098;color:#fff;text-decoration:none;font-family:sans-serif;"
>
  Tip with Kaspa
</a>
```

## Embed button package

The workspace package `@kaspa-actions/embed-button` generates safe Action links and button markup without tracking, wallet signing, or third-party scripts.

```ts
import { createKaspaActionButtonHtml, createKaspaActionUrl } from "@kaspa-actions/embed-button";

const actionUrl = createKaspaActionUrl({
  appUrl: "https://example.com",
  publicId: "demo-action",
});

const buttonHtml = createKaspaActionButtonHtml({
  appUrl: "https://example.com",
  label: "Tip with Kaspa",
  publicId: "demo-action",
});
```

The generated button is a normal `<a>` element pointing at `/a/:publicId`. It does not request wallet permissions, does not sign transactions, and does not perform payment detection.

## QR code image

Kaspa Links can render public URL QR images for both creator profiles and individual links:

```text
GET /api/profiles/:username/qr?format=svg&size=1024
GET /api/actions/:publicId/qr?format=png&size=1024
```

Supported formats are `svg` and `png`. Supported sizes are `512`, `1024`, and `2048`.

These QRs point to the Kaspa Links page first, not directly to a wallet URI. That keeps the payment
intent readable: supporters can verify the title, amount, recipient, safety notes, QR, copy, and
open-wallet options before paying.

The public Action page already renders a QR with the `kaspa:`-URI when a payment request is generated, so the simplest "live" QR experience is to link people to `/a/:publicId` and let them tap "Generate payment request".

## Social posts and chat messages

Social posts and chat messages can paste the Action URL directly. Public links include Open Graph
metadata for supported social previews:

```
Tip 10 KAS to support the stream:
https://example.com/a/demo-action
```

## OBS / stream overlay

Stream overlays can use a browser source pointed at `/overlay/:publicId`. See [OBS Stream Overlay](./overlay.md).

The overlay is display-only. It shows Action metadata, a payment QR, and optional PaymentRequest status polling via `?paymentRequestId=...`.

## What you should not do

- Do not embed custodial or server-side wallet signing flows. Users always pay from their own wallet.
- Do not ask supporters for private keys or seed phrases.
- Do not present demo mock-confirmation as real on-chain confirmation. If indexer detection is enabled, explain the indexer trust model.
- Do not build custody flows around Actions.

Future public embed work is described on the in-app `/roadmap` page.
