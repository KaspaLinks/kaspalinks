# On-chain Payment Detection

This page documents the optional indexer-backed flow that flips matching `PENDING` PaymentRequests to `CONFIRMED` on the basis of real on-chain data. It is opt-in and disabled by default.

## What it does (and what it doesn't)

When enabled, the public `GET /api/payment-requests/:id/status` endpoint additionally:

1. If the browser reports the wallet-returned `txId`, checks only that transaction through the Kaspa REST indexer. A missing or mismatching reported transaction never falls back to an unrelated address payment.
2. When no wallet transaction id is available, looks up recent transactions for the PaymentRequest's `recipientAddress` via the same indexer.
3. Filters for **accepted** transactions whose outputs match `(recipientAddress, amountSompi)` exactly and whose `block_time` is at or after the PaymentRequest was created (with a small clock-skew tolerance). For **variable-amount Actions** (`PaymentRequest.amountSompi === null`) any positive-value output to the recipient counts; the matched value is stored on the PaymentRequest at confirmation time.
4. If one matching transaction is already claimed by another PaymentRequest, continues scanning the remaining candidate outputs instead of stopping at the first hit. This matters when several same-amount tips reach the same creator address close together.
5. On a match, atomically writes `status = CONFIRMED`, `txId = <on-chain id>`, `confirmedAt = now()`, and `detectionSource = <provider id>` only while the row is still `PENDING`, plus an `AuditLog` entry `payment_request.chain_confirmed`. Lazy expiry uses the same conditional transition, so concurrent polls cannot overwrite each other.
6. Returns the now-confirmed PaymentRequest in the same response.

The indexer is queried **only on demand** (during a status read), with a per-request cooldown of
1.5 seconds. There is no background worker. Payment status checks use a fresh indexer read so a
just-broadcast transaction is not hidden behind stale dashboard caches; creator receipt views keep
their separate 30-second shared cache.

The flow does **not**:

- sign or broadcast transactions,
- touch private keys or seed phrases,
- introduce custody of any kind,
- replace the recipient's own wallet as the source of truth (a confirmed status here is one independent indexer's word; the operator's wallet is canonical).

## Configuration

| Variable                            | Default                 | Notes                                                                                                                                                 |
| ----------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KASPA_INDEXER_ENABLED`             | `false`                 | Master switch. Anything other than the exact string `true` disables the integration for **both** networks.                                            |
| `KASPA_MAINNET_INDEXER_URL`         | `https://api.kaspa.org` | Indexer used when a PaymentRequest's network is `mainnet`. Must be a Kaspa REST indexer compatible with the OpenAPI shape used by `api.kaspa.org`.    |
| `KASPA_MAINNET_INDEXER_PROVIDER_ID` | derived `rest:<host>`   | Free-form short id surfaced in audit log metadata.                                                                                                    |
| `KASPA_TESTNET_INDEXER_URL`         | _(empty)_               | Optional legacy/test fixture indexer used when an older PaymentRequest's network is `testnet`. New hosted Kaspa Links creation APIs are mainnet-only. |
| `KASPA_TESTNET_INDEXER_PROVIDER_ID` | derived `rest:<host>`   | Same as above.                                                                                                                                        |
| `KASPA_INDEXER_URL`                 | _(empty)_               | **Legacy fallback** used only for mainnet when `KASPA_MAINNET_INDEXER_URL` is not set. New deployments should leave this empty.                       |
| `KASPA_INDEXER_PROVIDER_ID`         | derived                 | Legacy provider id; same backward-compat path.                                                                                                        |

The detector picks an indexer **per PaymentRequest** based on the `network` column. New hosted Kaspa
Links creation APIs are mainnet-only, but the detector still understands legacy or test-fixture
PaymentRequests. A PaymentRequest on a network without a configured indexer simply stays `PENDING`
(no error), and the operator can still mock-confirm in demo mode.

## Trust model

The indexer is a third-party data source. Treat it as such:

- A `CONFIRMED` status surfaced through chain detection means _the indexer reported a matching accepted transaction_. The operator's own wallet remains the canonical source of truth.
- Because matching uses `(address, exact-amount, time window)`, accidental matches require an attacker to send the **exact** sompi amount inside the request window. Picking unique sompi amounts or letting supporters request short-lived PaymentRequests (15 minutes) keeps this risk low.
- **Variable-amount PaymentRequests** trade some of that precision: any positive-value tx to the recipient within the 15-minute window confirms the request. Suitable for tips and donations because the recipient address is usually the operator's own; not recommended for invoices where mismatching another supporter's payment with the wrong PaymentRequest would be a problem. Prefer fixed amounts whenever a specific bill is being collected.
- The schema enforces `UNIQUE(txId)`. If a second PaymentRequest is created with the same recipient and amount, only the **first** one that observes the on-chain tx is confirmed against it; subsequent reads do not flip a different request.
- The integration **never** moves funds. A wrong indexer answer cannot drain a wallet — it can only mislabel a PaymentRequest as confirmed.

## Compatible REST shape

`createRestKaspaIndexer` calls:

```text
GET {KASPA_INDEXER_URL}/transactions/{transactionId}

GET {KASPA_INDEXER_URL}/addresses/{recipientAddress}/full-transactions-page
  ?limit=10
  &fields=transaction_id,outputs,block_time,is_accepted
  &resolve_previous_outpoints=no
  &after=<ms-epoch-with-skew>
```

The response must be a JSON array of objects with at least:

```jsonc
[
  {
    "transaction_id": "abc...",
    "is_accepted": true,
    "block_time": 1770000000000,
    "outputs": [
      {
        "index": 0,
        "amount": 1000000000, // number OR decimal string
        "script_public_key_address": "kaspa:...",
      },
    ],
  },
]
```

`amount` may be a JSON number or a decimal string; the adapter parses both safely via `BigInt`. `block_time` may be a number or a numeric string.

## Audit log

| Event                             | When                                                | Metadata                          |
| --------------------------------- | --------------------------------------------------- | --------------------------------- |
| `payment_request.chain_confirmed` | A real on-chain match was applied.                  | `{ txId, outputIndex, provider }` |
| `payment_request.mock_confirmed`  | Admin used the demo mock-confirm route (unchanged). | `{ fakeTxId }`                    |
| `payment_request.lazy_expired`    | Request hit `expiresAt` while still pending.        | —                                 |

`detectionSource` on the PaymentRequest distinguishes real (`rest:api.kaspa.org`, etc.) from mocked (`mock`) confirmations in the public JSON.

## Operational notes

- Public `api.kaspa.org` is rate-limited. The 1.5-second per-PR cooldown is reserved for the short
  live-payment window and still sits below the app's own public status rate limit; a busy deployment
  should consider running an indexer mirror.
- A failed indexer call (network error, 5xx) is **non-fatal**: the status endpoint logs the error in the server console and falls back to the existing behavior (lazy expiry + existing status). The PaymentRequest stays `PENDING` until a later read succeeds.
- The mock-confirm route stays functional regardless of `KASPA_INDEXER_ENABLED`. It writes `detectionSource = "mock"`, so audit log readers can distinguish demo confirmations from real ones.

## Disabling

Set `KASPA_INDEXER_ENABLED=false` (or remove it from `.env`) and recreate the app container. The status endpoint reverts to the original lazy-expiry-only behavior. Existing `CONFIRMED` rows are not touched.
