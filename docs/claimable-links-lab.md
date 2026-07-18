# Claimable Links Technical Notes

Status: historical design and verification notes. For the public user-facing
overview, start with [claimable-links.md](./claimable-links.md).

## Goal

A claimable link lets a creator lock a small amount of KAS into a link and share
that link. The first eligible claimant opens it, connects a wallet, enters or
confirms a receiving address, and claims the KAS directly from the on-chain
output.

Kaspa Links must remain non-custodial:

- the server never holds the funds
- the server never stores a private key
- the server never stores a seed phrase
- the server never signs the funding transaction
- the server never signs the claim transaction
- production should prefer wallet/browser broadcast where possible; the relay may
  forward an already signed transaction only after an explicit user action
- funds move from the funder's wallet into a script-controlled UTXO, then from
  that UTXO to the claimant wallet or back to the funder after expiry

## Why This Needs Toccata

Without a covenant/script-controlled UTXO, a "first person to claim this link"
flow becomes either custodial or key-sharing:

- custodial server wallet: forbidden
- server-held private key: forbidden
- claim URL containing a _wallet_ private key, or a key to a plain unscripted
  output: forbidden (naive key-sharing — no script, no refund path, funder
  keeps a copy). A fresh, script-bound one-time claim key in the URL fragment
  is a different construct and is the chosen design — see "Claim-Key Design"
  below.
- pre-signed transaction to one fixed address: not a real claim link, because
  the claimant address is not known yet

The Toccata path is a script-controlled output whose spend validates the claim
or refund rules.

## Research Findings (2026-07, lab + upstream)

These findings came out of the Toccata lab probes and a review of the official
Silverscript examples (`kaspanet/silverscript`, verified examples:
`covenant_escrow.sil`, `hodl_vault.sil`). They materially shorten the critical
path and raise one design decision.

### 1. One-shot claim/refund does not need covenant output bindings

The official escrow example enforces payout destination and amount purely with
transaction introspection (`tx.outputs[i].scriptPubKey` / `.value`,
`this.activeInputIndex`) inside an ordinary spend-condition contract. Covenant
output bindings / covenant ids (KIP-20 lineage) are only required for stateful
multi-transaction covenants (counter/KCC20 patterns). A claimable link is
one-shot — fund, then claim or refund — so its state (hashes, keys, expiry)
lives in the redeem-script constructor args, not in covenant output state.

Consequence: **the funding transaction pays a plain P2SH address with no
covenant field.**

### 2. That removes the SafeJSON covenant blocker from the funding path

The lab proved the vendored SDK v2.0.1 rejects covenant-bearing outputs on the
Transaction/SafeJSON path ("Slice must have the length of Hash"). With a plain
P2SH funding output this no longer gates claimables: funding is an ordinary
payment any current wallet can make today (normal payment URI/QR — no
`signPskt` involvement for funding). The lab covenant probe stays valuable as
an SDK regression tracker and should be reported upstream.

### 3. Front-run safety needs a signature, not only a preimage

A pure hashlock preimage becomes visible in the mempool, and "pay only the key
the presenter provides" does not protect a fresh recipient — an observer can
present their own key with the stolen preimage. The mempool-safe primitive is a
**link-key signature**: the URL fragment carries a freshly generated per-link
private key; the claim entrypoint requires `checkSig(linkSig, linkPk)`.
Because the signature covers the transaction outputs, an observer cannot
redirect the payout without invalidating the signature.

**Decided (2026-07): link-key signature.** The original "no private key in
URL" rule targeted naive keyed outputs (no script, no refund, funder keeps a
copy); it is refined above to say what it meant. At script level the link key
is one entrypoint of a refundable script UTXO and exactly as much a bearer
secret as a preimage — every claim link is a bearer instrument by definition.
The rejected alternative, preimage plus a two-step commit-reveal flow, would require
stateful multi-transaction covenant machinery (the exact path findings #1/#2
removed), a second transaction with fees/storage-mass on tiny amounts, and it
still needs a browser-generated claimant key for the commit — so it avoids
nothing. The link key additionally never becomes public (a preimage is exposed
in the mempool at claim time). See "Claim-Key Design" below for the spec.

### 4. Wallet-independence option for claim and refund

With a link-key claim (and optionally a funder-saved refund key, mirroring the
existing creator-token "save this now" pattern), neither the claim nor the
refund spend needs wallet PSKT/SafeJSON signing at all: both spends can be
built and signed in the claimant's/funder's browser via kaspa-wasm and
broadcast through a public node endpoint. Wallets then only perform the
ordinary funding payment. Trade-offs to review: kaspa-wasm enters the claim
page's client bundle (deliberate exception to the server-only rule), a
broadcast route is needed, and the refund key is a second bearer secret.

### 5. Silverscript is testnet-12-only and experimental

Upstream README (checked 2026-07): experimental, no releases, breaking changes
without notice, and **compiled scripts are valid only on Kaspa Testnet 12** —
not on mainnet.

Mainnet canary update (2026-07-04): a minimal compiled claim/refund P2SH output
was funded with 0.25 KAS and claimed on mainnet through the `kaspa-wasm` wRPC
SDK. Accepted transaction:

```text
cd80138b9ed26d22df44e43195ba5c92245f02e514584b2073b57206d79b4f3a
```

This proves the specific canary script bytes can execute on mainnet, but it
does **not** make Silverscript production-ready. Product integration still
needs byte review, fee/mass automation, refund-path validation, and upstream
clarification on compiler support.

Unreviewed sketch of the minimal contract shape:

```silverscript
contract ClaimableLink(pubkey linkPk, pubkey refundPk, int refundAfter) {
    entrypoint function claim(sig linkSig) {
        require(checkSig(linkSig, linkPk));
    }
    entrypoint function refund(sig refundSig) {
        require(checkSig(refundSig, refundPk));
        require(tx.time >= refundAfter);
    }
}
```

### 6. Mainnet submit path and pricing notes

The current public REST proxy rejected v1 canary submissions because the proxy
schema still required legacy `sigOpCount`, while the node expects v1
`computeBudget`. Direct `kaspa-wasm` wRPC submission worked.

Pricing observations from the accepted claim:

- script units used: `100293`
- v1 compute budget used: `11`
- starting fee: `200000` sompi
- accepted output: `24800000` sompi
- accepted transaction mass: `1826`

UI update (2026-07-04): the claimable-link flow now follows the intended product
shape instead of an operator-command workflow. The page lets the creator choose
the amount the recipient should receive, a fee, and an expiry, previews the exact
funding amount and refund lock time,
derives a one-time experimental P2SH funding address from browser-generated
claim/refund public keys, and keeps the claim link locked until exact on-chain
funding is detected. The old setup/claim/refund command blocks, PSKT internals,
and wallet-probe controls are no longer part of the main UI.

The current page can create a real fundable address, detect exact funding, sign
claim/refund Transaction SafeJSON in the browser, and broadcast the signed
transaction after an explicit user click. The old command bridge is closed:
claim/refund codes stay in the browser and are not sent to the server. The
broadcast endpoint receives signed JSON only.

The claim link hydrates the receiver preview from the URL fragment. This keeps
the claim code out of HTTP requests.

Funding remains an ordinary wallet transfer to the generated P2SH address:
KasWare, Kaspium, or any wallet that can send to the address can fund it. The
claim/refund logic only applies to the later spend of that script output.
Refunds are not automatic chain events; after the lock time passes, a refund
transaction can spend the still-unclaimed output back to the refund destination.

Plain-language explanation for users:

- A creator creates a claimable link and chooses an amount plus a validity
  window.
- The browser creates a one-time claim code and a separate refund code. Kaspa
  Links should receive only public keys and public metadata.
- The creator funds a generated Kaspa script address with a normal wallet
  transfer.
- The claim link should be shared only after the exact funding output is found
  on-chain.
- The receiver opens the link, enters a Kaspa address, and explicitly claims.
  The browser signs the claim transaction with the one-time claim code.
- The receiver page shows a live countdown based on the current Kaspa DAA score
  so the remaining claim window is visible before refund unlock.
- After the claim window expires, Kaspa Links must stop preparing and relaying
  claim transactions. The protected lab broadcast route enforces this with a
  current DAA check before the signed transaction is sent to the wRPC relay.
- Kaspa Links must not hold the KAS, seed phrase, wallet private key, claim
  code, or refund code. The server may relay only the signed transaction JSON.
- If the link is not claimed before the selected time, the creator refund path
  unlocks. Refund is not automatic; the creator still needs to sign and
  broadcast a refund while the output remains unspent.

Current lab caveat: the ScriptBuilder contract used by the protected lab unlocks
the refund path after expiry, and Kaspa Links refuses claim preparation/relay
after expiry. The output is still only finally closed on-chain once it is claimed
or refunded. A cryptographic upper-bound that prevents any custom off-site claim
broadcast after expiry would require a revised reviewed script or a future
primitive that exposes current consensus time/DAA to the script.

### One-time batch allocator

The protected `/toccata-lab/batch` flow accepts two to ten child links. One
ordinary wallet payment funds a browser-derived allocator address. Its
activation branch commits one input and the exact ordered amount and script
public key of every child output. Its refund branch becomes available at the
shared DAA deadline if activation never happened.

The activation branch itself has no on-chain upper deadline. Kaspa Links
therefore checks current mainnet DAA in the browser and again in the authenticated
activation API immediately before relay. Once the deadline is reached, activation
is refused and only the whole-batch refund is available. Activation and refund
also reserve mutually exclusive pending transitions in PostgreSQL before relay,
preventing concurrent UI requests from starting both outcomes.

`labs/claimable-script/claimable_batch_allocator_tests.rs` pins the exact web
script bytes and executes the activation/refund branches with the Toccata v2.0.1
TxScriptEngine. It covers exact activation, changed amounts and destinations,
wrong input/output counts, unrelated signatures, and refund timing/key checks.

### 7. Revised critical path

1. ~~Decide claim primitive~~ — decided 2026-07: link-key signature (see
   finding #3 and "Claim-Key Design").
2. TN12 prototype: compile the contract, then fund → claim → refund end to end
   (see "Testnet-12 Prototype Plan").
3. ~~In-browser key generation + server-side script-address derivation~~ —
   done with browser-held secrets and public-key-only server input.
4. Exact funding detection through the existing Kaspa REST indexer — done with
   a locked share gate.
5. ~~Lab-only signed claim/refund Transaction SafeJSON builder~~ — replaced by
   browser-side signing; the protected bridge route is deliberately closed.
6. ~~In-browser build/sign/broadcast spike~~ — done with the vendored
   `web/kaspa` browser bundle, explicit broadcast button, and the 0.2 KAS
   minimum-output policy.
7. Mainnet script decision: wait for compiler maturity vs hand-written,
   byte-reviewed script; the canary proves feasibility, not production safety.
8. Wallet `signPskt`/covenant support keeps being tracked separately but is no
   longer the gate for a v1 claimable.

## Claim-Key Design (decided 2026-07)

External naming: **claim code**. It is technically a per-link secp256k1
private key, but it must never be presented as a "wallet key" — it is a
one-time bearer credential for a single script UTXO.

Generation and custody:

- generated **client-side in the creator's browser** (kaspa-wasm keypair from
  a CSPRNG, full 32-byte entropy) at link creation
- the server receives and stores **only the public key** (`linkPk`) and public
  metadata; the claim code never reaches the server
- the refund key follows the same pattern (client-generated; the funder must
  save it — same "save this now, it cannot be recovered" UX as the existing
  creator token). This keeps wallets out of claim _and_ refund spends.

Transport and exposure rules:

- the claim code travels **only in the URL fragment**
  (`/claim/<public-id>#claim=<code>`), never in path, query, or headers
- the claim page must not send the fragment anywhere: no analytics, no
  logging, no error reporters on that route; the claim spend is built and
  signed in the browser
- documented residual risks (inherent to any claim link, identical for a
  preimage design): browser history, clipboard, messenger link previews that
  execute JavaScript. Docs and UI copy must say "the link is the money".

Why it is front-run-safe: the claim entrypoint requires a signature from
`linkPk` that covers the transaction outputs, so a mempool observer sees a
signature but never the key and cannot redirect the payout. The claim code
never becomes public — unlike a hashlock preimage, which is exposed to the
mempool at claim time.

## Testnet-12 Prototype Plan

Goal: prove fund → claim → refund end to end with the real compiler and a real
TN12 node, before any mainnet or product work.

### Mainnet fast path (research 2026-07)

Verified upstream state: the Silverscript repo's last commit (2026-06-28, two
days before mainnet activation) bumps rusty-kaspa to v2.0.1 — the exact
Toccata release this project vendors. The "valid only on Testnet 12" README
note has not been revisited since activation; there is no upstream issue,
commit, or statement about mainnet validity either way. Official Kaspa docs
call Silverscript "the recommended covenant authoring direction while checking
release and audit status" and note the tooling is younger than the consensus
features. Conclusion: mainnet compatibility of compiled bytes is _plausible_
(same rusty-kaspa target, opcodes active on mainnet since 2026-06-30) but
_unconfirmed by any authoritative source_.

Revised sequence that reaches mainnet fastest without betting funds on the
unconfirmed part:

1. **Ask upstream** (GitHub issue on `kaspanet/silverscript`): is the TN12-only
   note still accurate post-Toccata activation? Zero cost, authoritative
   answer, active repo.
2. **Local script-engine verification instead of a live TN12 node first:**
   compile `claimable_link.sil` and execute the claim/refund/expiry paths in
   the repo's own test harness / cli-debugger under mainnet parameters. This
   verifies script execution with no network and no funds at risk, and can
   replace most of the live TN12 validation work.
   - ✅ **Done (2026-07):** all six engine tests pass on kaspa-txscript
     v2.0.1 (the Toccata mainnet release engine, `covenants_enabled: true`):
     claim/refund happy paths, wrong-key and pre-expiry rejections, and the
     front-run case (tampered outputs invalidate a reused claim signature).
     See `labs/claimable-script/README.md` for the harness and results.
     Answered along the way: entrypoint/argument encoding is produced by the
     compiler's `build_sig_script`, and `tx.time` reads the transaction
     `lock_time` at engine level (consensus-side DAA enforcement still needs
     the canary).
   - ✅ **Added for the web lab (2026-07):** the operator UI currently uses a
     separate hand-built ScriptBuilder contract, not the Silverscript-compiled
     artifact. `labs/claimable-script/claimable_ui_scriptbuilder_tests.rs`
     pins the exact UI redeem-script bytes and runs claim/refund/wrong-key and
     output-tamper cases through the same v2.0.1 `TxScriptEngine`. Result on
     2026-07-05: 7/7 tests passed on the Hetzner lab checkout. This keeps the
     current `/toccata-lab` proof scoped to the artifact it actually funds.
3. **Mainnet canary** in the existing operator-only lab frame: fund → claim →
   refund with 0.2–1 KAS whose total loss is priced in. Only after 1 + 2 give
   green signals.
4. **Live TN12 node as fallback** only if upstream answers "TN12-only is
   real" or local execution reveals network-parameter gaps.

5. **Toolchain (reproducibility first).** Clone `kaspanet/silverscript`,
   pin the exact commit in this doc, `cargo build`, compile
   `claimable_link.sil`. Record compiler commit + SHA-256 of the emitted
   script bytes — this is the "generated script bytes reproducible" gate.
6. **Contract.** Start from the reviewed sketch (finding #5):
   `ClaimableLink(pubkey linkPk, pubkey refundPk, int refundAfter)` with
   `claim(sig)` and `refund(sig)` entrypoints. Extend only if the prototype
   forces it.
7. **TN12 infra.** Run a rusty-kaspa node on Testnet 12 (the network
   Silverscript output is valid on), obtain faucet funds. No product
   infrastructure is touched.
8. **End-to-end harness** (standalone lab scripts, e.g. `labs/tn12-claimable/`
   — not part of the web app):
   - generate claim + refund keypairs
   - derive the P2SH address from the compiled script; fund it with an
     ordinary TN12 payment
   - build + sign the claim spend with the claim key (SIGHASH covering
     outputs), submit to the node, verify acceptance — output must respect
     the 0.2 KAS minimum-output policy and storage mass
   - negative tests: refund before expiry must fail; a modified-output claim
     with a reused signature must fail (front-run check)
   - refund after expiry must succeed
9. **Open questions the prototype must answer** (record answers here):
   - exact `signatureScript` layout for Silverscript entrypoints (entrypoint
     selection + argument encoding)
   - `tx.time` semantics on Kaspa (DAA score vs timestamp threshold) and the
     right expiry encoding for `refundAfter`
   - sighash flags available to in-script `checkSig`
   - storage-mass behavior of the claim spend at small amounts
   - node submit API shape for the later in-browser broadcast route
10. **Exit criteria.** All five flows above demonstrated on TN12 with pinned,
    reproducible script bytes → then (and only then) design review for the
    mainnet script path (compiler maturity vs hand-written script) and the
    in-browser build/sign/broadcast spike.

## Proposed Architecture

Use a Toccata plain P2SH script output.

The funder signs a funding transaction payload in their wallet. The funding
transaction creates one claimable UTXO whose redeem script commits to the
claim-link state.

State fields:

- `link_id_hash`
- `link_public_key`
- `amount_sompi`
- `refund_public_key`
- `refund_after_daa_score` or another reviewed expiry mechanism
- optional metadata hash for the public Kaspa Links record

The claim URL must contain the claim code only in the URL fragment:

```text
https://kaspalinks.com/claim/<public-id>#claim=<claim-code>
```

The fragment is read by the browser but is not sent in HTTP requests. Store only
the public link key and public metadata on the server.

## Funding Flow

1. Creator chooses amount, expiry, and label.
2. Browser creates the random claim-code keypair and refund keypair locally.
3. Browser sends only public keys and public metadata to the server.
4. The app derives the P2SH funding address from the reviewed script bytes.
5. Creator wallet funds that P2SH address with an ordinary Kaspa payment.
6. Kaspa Links indexes the funded output and marks the link as `FUNDED`.
7. Creator shares the claim URL with the claim code in the URL fragment.

Open review point: exact transaction construction depends on the chosen
Silverscript/raw-script ABI. Per Research Findings #1/#2 above, the funding
output is a plain P2SH payment — covenant output bindings and wallet SafeJSON
signing are no longer on the funding path.

## Claim Flow

1. Claimant opens the link.
2. Browser reads `claim=<claim-code>` from the URL fragment.
3. Browser checks that the claim code derives the stored public link key.
4. Claimant enters or confirms a receiving address.
5. Browser builds and signs the claim-spend transaction with the claim code.
6. Browser submits the transaction only after an explicit claimant action.
7. Kaspa Links indexes the spend and marks the link as `CLAIMED`.

The script must validate:

- the claim signature verifies against `link_public_key`
- the signature covers the transaction outputs
- the transaction does not create an unauthorized successor
- fee/change behavior is explicitly constrained

## Front-Run Protection

The claim code signs the claim transaction. With `SIGHASH_ALL`, that signature
covers the outputs, so a mempool observer cannot reuse the signature with a
different destination. The claim code itself never appears in the transaction;
only the signature does.

This needs to be proven with the actual Silverscript or raw-script generated
bytecode before any fundable lab release.

## Refund Flow

After expiry, the funder can recover the unclaimed output.

1. Funder opens the claimable-link management page.
2. App finds the live claimable UTXO.
3. Browser builds and signs the refund transaction with the saved refund key.
4. Browser submits the transaction only after an explicit funder action.
5. Kaspa Links indexes the spend and marks the link as `REFUNDED`.

The refund spend must validate:

- expiry condition is satisfied
- output pays the original refund script or reviewed refund address
- claimant path can no longer be used after the refund

For the current lab script, expiry means "refund path unlocked", not an
automatic refund. Once the refund transaction is accepted, the funding output is
spent and the claim link is closed.

## Fee Model

The creator enters the advertised amount the recipient should receive. Kaspa
Links adds the claim/refund fee to the one-time funding output, so a `10 KAS`
claim with a `0.002 KAS` fee requires exactly `10.002 KAS` of funding and pays
the claimant exactly `10 KAS`. Batch funding applies the same calculation to
each child output and adds the separate activation-transaction fee to the exact
batch total.

All calculations use sompi and integer arithmetic. The claimant does not provide
an additional wallet input.

New public claimable-link creation starts at 1 KAS and has no artificial
Kaspa Links maximum. Older lab links below 1 KAS can still be resolved for
claim/refund testing as long as the spend keeps the final output above the
storage-mass floor.

## Server Data

Allowed:

- public id
- amount
- expiry
- claim secret hash
- funding transaction id
- funding outpoint
- status
- public metadata
- audit logs without secrets

Forbidden:

- claim secret plaintext
- private keys
- seed phrases
- raw wallet secrets
- server-generated spend authority
- full request bodies containing wallet data

## Status Model

Suggested states:

- `DRAFT`
- `AWAITING_FUNDING`
- `FUNDED`
- `CLAIMING`
- `CLAIMED`
- `EXPIRED`
- `REFUNDABLE`
- `REFUNDED`
- `FAILED`

Only one terminal spend can win because the live UTXO can only be spent once.
The app must rely on the chain/indexer for final status.

## Required Gates Before Fundable Lab

- Silverscript or raw-script source reviewed
- generated script bytes reproducible
- script validates output layout, not only inputs
- claim secret generated client-side only
- claim URL uses fragment for the secret
- KasWare `signPskt` tested with a real Transaction SafeJSON shape that includes
  wallet-owned inputs and explicit `signInputs`
  - format half confirmed by operator test (2026-07): KasWare decoded the
    SafeJSON smoke transaction and echoed it back unchanged (empty inputs, no
    error), and rejected the legacy PSKT wrapper as expected — the
    wallet-owned-input signing test is the remaining half
- Kaspium or another mobile path evaluated separately
- indexer can identify funding output and terminal spend
- refund path tested
- fee model tested
- small mainnet range enforced
- legacy smoke endpoints remain operator-gated

## Non-Goals

- no server custody
- no server key generation
- no secret-bearing API payloads
- no claimable links in normal `/new-link`
- no promise of production safety until the script and wallet flow are reviewed
