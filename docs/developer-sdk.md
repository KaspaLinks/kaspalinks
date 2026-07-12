# Developer SDK

The workspace package `@kaspa-actions/sdk` is a small TypeScript client for the public Kaspa Actions API.

It is intentionally **not** a wallet SDK. It does not request wallet permissions, does not sign transactions, does not broadcast transactions, does not use admin tokens, and does not perform blockchain detection itself.

## Install

Inside this workspace:

```ts
import { createKaspaActionsClient } from "@kaspa-actions/sdk";
```

The package has no runtime dependencies. It expects a standard `fetch` implementation, which is available in modern browsers and current Node.js versions. You can also inject a custom `fetch` for tests.

## Create a Client

```ts
import { createKaspaActionsClient } from "@kaspa-actions/sdk";

const client = createKaspaActionsClient({
  appUrl: "https://example.com",
});
```

`appUrl` must be an absolute `http` or `https` URL pointing at your Kaspa Actions deployment.

## Build an Action URL

```ts
const url = client.createActionUrl("demo-action");
// https://example.com/a/demo-action
```

Use this for links, buttons, profile pages, static embeds, and QR-code generation.

## Fetch Public Metadata

```ts
const action = await client.getAction("demo-action");

console.log(action.title);
console.log(action.amountKas);
console.log(action.recipientAddress);
```

Returned metadata follows [Public Kaspa Action Specification](./public-action-spec.md).

## Create a PaymentRequest

```ts
const paymentRequest = await client.createPaymentRequest("demo-action", {
  requestedMessage: "Thanks for the guide",
});

console.log(paymentRequest.status); // PENDING
console.log(paymentRequest.paymentUri);
```

PaymentRequests expire after 15 minutes. Depending on the deployment, status can come from demo mock-confirm or optional indexer-backed detection.

## Poll Status

```ts
const current = await client.getPaymentRequestStatus(paymentRequest.id);

console.log(current.status);
```

Client apps should poll no faster than the frontend default of 3 seconds.

## Error Handling

API errors throw `KaspaActionsApiError`.

```ts
import { KaspaActionsApiError } from "@kaspa-actions/sdk";

try {
  await client.getAction("missing-action");
} catch (error) {
  if (error instanceof KaspaActionsApiError) {
    console.log(error.status);
    console.log(error.code);
    console.log(error.message);
  }
}
```

The error shape mirrors the public API:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Action not found."
  }
}
```

## Security Notes

- Do not pass admin tokens to this SDK.
- Do not use this SDK for server-side signing.
- Do not ask users for private keys or seed phrases.
- Do not treat mocked `CONFIRMED` status as real on-chain detection. If `detectionSource` is an indexer provider, still treat the recipient wallet as the source of truth.
- Render Action titles, descriptions, and messages as escaped text.
- Ask users to verify recipient addresses in their wallet before paying.

## Included Helpers

- `createKaspaActionsClient(options)`
- `client.createActionUrl(publicId)`
- `client.getAction(publicId)`
- `client.createPaymentRequest(publicId, input?)`
- `client.getPaymentRequestStatus(id)`
- `KaspaActionsApiError`

## Out of Scope

- Wallet transaction signing or broadcasting.
- Running blockchain/indexer detection inside the SDK.
- Admin Action creation/update APIs.
- Mock-confirm admin APIs.
- Custodial balance handling.
- Bot-specific wrappers.
