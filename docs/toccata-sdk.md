# Toccata SDK Integration

Kaspa Links uses the vendored `kaspa-wasm` package from the official
`rusty-kaspa v2.0.1` WASM32 SDK release.

Source release:

https://github.com/kaspanet/rusty-kaspa/releases/tag/v2.0.1

Official SDK asset:

`kaspa-wasm32-sdk-v2.0.1.zip`

Official asset SHA-256, as published by the GitHub release API:

`7eaffac9cd920ef2fdf540c6e10f2a2b7761170ebc62ec57dfa0f71c64567a71`

Vendored subsets:

`vendor/kaspa-wasm-v2.0.1`

`apps/web/public/vendor/kaspa-wasm-v2.0.1/web/kaspa`

The `nodejs/kaspa` package is used by server/test code. The `web/kaspa` browser
bundle is vendored under `public/` for claimable-link signing so claim/refund
spends can be signed client-side without sending claim/refund codes to the
server.

Vendored Node file checksums, verified against the official SDK asset:

| File            | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| `kaspa_bg.wasm` | `9427733cb0cb1c78cc3f2cc9f77f4153426636925ced0256c5c30e4edc199eaa` |
| `kaspa.js`      | `1e0ad892861bf3e0a63ba8ed51366efc2b812c5a34c6895385ee2f9d026d2fc1` |
| `kaspa.d.ts`    | `419603c791100bb19eeacbbfb49e3dc734d832a0bffc0d11582c73af6c30e704` |

Vendored browser file checksums, verified against the official SDK asset:

| File            | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| `kaspa_bg.wasm` | `5f90736c80721027ecea1a51509005ebb37a434857fb4882ff03b20b24b923a9` |
| `kaspa.js`      | `82202df28a83b6da08a4fa4a9184b9ad4ef0185d9d9df333544cf7c17013daca` |

## Why This Exists

The public NPM `kaspa-wasm` package still resolves to the older `0.13.0`
package, while Toccata work needs the updated `2.0.1` WASM SDK surface.

The project now points `@kaspa-actions/kaspa` at the vendored package via:

```json
"kaspa-wasm": "file:../../vendor/kaspa-wasm-v2.0.1"
```

This keeps local development and Hetzner Docker builds reproducible without
downloading release artifacts during deployment.

## Capability Gate

Toccata-specific work must go through the helper in
`packages/kaspa/src/toccata.ts`.

The helper checks for the SDK exports needed before covenant/claimable-link work
is enabled, including:

- `Address`
- `CovenantBinding`
- `Opcodes`
- `PSKT`
- `PaymentOutput`
- `ScriptBuilder`
- `SigHashType`
- `Transaction`
- `TransactionInput`
- `TransactionOutput`
- `addressFromScriptPublicKey`
- `covenantId`
- `payToScriptHashScript`
- `payToScriptHashSignatureScript`

Do not enable claimable links, refunds, split rules, or vault logic unless
`assertToccataSdkReady()` passes in the runtime being used.

## Current Scope

This integration does not implement public production claimable links yet.

Current scope:

- replace the old WASM package with the official Toccata-ready SDK
- expose a small capability gate for future Toccata features
- provide an operator-only mainnet claimable-link lab
- keep existing payment links, address validation, and non-custodial rules intact

Mainnet lab:

- `/toccata-lab` is available as an opt-in operator test bench when
  `TOCCATA_LAB_ENABLED=true`.
- The bundled Caddyfile protects `/toccata-lab` and `/api/toccata-lab/*` with
  the operator Basic Auth gate. Keep that protection in place on public
  deployments.
- If you self-host with a different reverse proxy, do not expose the lab
  publicly. `TOCCATA_LAB_ENABLED=true` only enables the app feature; deployment
  authentication must still protect the page and API routes.
- Claimable-link creation starts at `1` KAS and has no artificial Kaspa Links
  maximum. Lower legacy test outputs can be rejected by wallets because of
  Kaspa's storage-mass rules. Funding is an ordinary wallet payment
  to a one-time P2SH address. Claim/refund spends are signed in the browser with
  the fragment claim/refund code; the server receives only signed Transaction
  SafeJSON if the operator explicitly clicks broadcast.
- The QR endpoint does not accept raw QR payloads. It receives the same
  `recipientAddress`, `amountKas`, `label`, and `message` fields as the intent
  endpoint and rebuilds the Kaspa URI through the same validation path.
- The lab keeps a rich debug payment URI with `label`/`message`, but the QR code
  and **Open in wallet** link use a conservative Kaspium-safe URI with only
  recipient address and amount.
- `/api/toccata-lab/pskt-smoke` runs a deterministic SDK smoke test that derives
  a script-hash address from an `OP_FALSE` script, derives a covenant id from a
  dummy genesis outpoint, builds a covenant-bearing output, and creates an
  unsigned constructor-role PSKT with one non-covenant output. The derived
  address is marked unsafe to fund and is not a claimable-link address. This is
  an internal SDK/PSKT shape check, not the current KasWare signing payload.
- `/api/toccata-lab/safe-json-smoke` builds a decode-only
  `Transaction.serializeToSafeJSON()` payload and round-trips it through
  `Transaction.deserializeFromSafeJSON()`. It has no inputs, no signatures, and
  is not wallet-signable; it exists to verify the wallet-facing JSON shape before
  a real UTXO-backed self-spend probe is added. The smoke also runs a
  covenant-bound output through the same SafeJSON round trip and reports in
  `prototype.covenant` whether the binding is carried and preserved — the
  transport question covenant-era wallet flows depend on.
- The lab page can probe KasWare for its `signPskt` page-provider method and,
  after an explicit operator click, forward the SafeJSON smoke transaction to
  the wallet — the format KasWare documents for `signPskt`. The legacy unsigned
  smoke PSKT can still be sent as a negative compatibility check; current
  KasWare builds are expected to reject the internal PSKT wrapper JSON. Both
  payloads contain no inputs, so approving them cannot move funds. Kaspa Links
  does not sign, fund, or broadcast from these probes.
- **Operator test result (2026-07):** KasWare `signPskt` decoded the SafeJSON
  smoke transaction and returned it unchanged (same id, empty inputs, output
  intact, no error) and rejected the legacy PSKT wrapper — confirming that
  rusty-kaspa `serializeToSafeJSON()` output is directly compatible with
	  KasWare's documented signing surface. Remaining wallet gate: the same probe
	  with a real wallet-owned input and explicit `signInputs`.
- `/api/toccata-lab/claimable-spend` is deliberately closed. The old protected
  server-side spend-signing bridge must not be used by client code, and the
  web app library no longer exposes a helper/schema that accepts claim/refund
  private keys.
- `/api/toccata-lab/claimable-broadcast` accepts signed Transaction SafeJSON,
  validates the single-input/single-output lab shape, and forwards it to the
  internal `toccata-relay` service. The relay keeps a reusable Kaspa wRPC client
  and submits with `RpcClient.submitTransaction()`, avoiding the old per-request
  Node child-process startup. It never receives claim/refund codes.
- `/toccata-lab` uses a hand-built ScriptBuilder contract for the current
  operator UI. Its exact bytes and engine behavior are covered by
  `labs/claimable-script/claimable_ui_scriptbuilder_tests.rs`; do not treat the
  Silverscript harness alone as proof for the UI contract.
- Claimable-link design notes live in
  [`claimable-links-lab.md`](./claimable-links-lab.md). This is a review
  document, not an implementation.

Next technical step:

- decide whether production claim/refund should keep the current browser-signed
  link-key flow, add wallet-side signing where possible, or support both paths
- review the exact Silverscript/raw-script bytes before any public production
  claimable-link release
- keep wallet-facing signing experiments behind the lab gate and the same
  no-server-keys and no-custody rules
