# OBS Stream Overlay

Kaspa Links includes a lightweight overlay page for OBS and other browser-source tools.

The overlay is display-only. It does not create Actions, does not use admin tokens, does not request wallet permissions, and does not sign or broadcast transactions.

## URL

```text
https://example.com/overlay/:publicId
```

Example:

```text
https://example.com/overlay/demo-action
```

The overlay shows:

- Action title
- Action type
- amount in KAS
- shortened recipient address
- QR code for the payment URI
- non-custodial warning
- non-custodial status warning

## Payment Status

To show status for a specific PaymentRequest, add `paymentRequestId`:

```text
https://example.com/overlay/demo-action?paymentRequestId=<payment-request-id>
```

When a valid payment request id is present, the overlay polls:

```text
GET /api/payment-requests/:id/status
```

Polling runs every 3 seconds and stops once the request is no longer `PENDING`.

## OBS Setup

Recommended Browser Source settings:

- Width: `1280`
- Height: `720`
- Custom CSS: none required
- Shutdown source when not visible: optional
- Refresh browser when scene becomes active: optional

The page uses a transparent background outside the overlay panel. In OBS, place it over your stream layout and crop as needed.

## Demo Flow

1. Open `/a/demo-action`.
2. Generate a PaymentRequest.
3. Copy the payment request id.
4. Open `/overlay/demo-action?paymentRequestId=<id>` in an OBS Browser Source.
5. Use the admin demo mock-confirm flow.
6. Watch the overlay status move from `PENDING` to `CONFIRMED`.

The demo confirmation is mocked. If indexer-backed detection is enabled, explain that the indexer reported a matching transaction and the recipient wallet remains the source of truth.

## Security Notes

- Never put `ADMIN_ACCESS_TOKEN` in an overlay URL.
- Never expose private keys, seed phrases, wallet credentials, or Authorization headers.
- The overlay must remain public-display only.
- Users must verify the recipient address in their wallet before paying.
