# Claimable-Link Script Lab

Standalone lab for the `ClaimableLink` Silverscript contract — **not** part of
the web app. See `docs/claimable-links-lab.md` for the design, decision record,
and gates.

## Contract

[`claimable_link.sil`](./claimable_link.sil) — minimal one-shot claim/refund
lock:

- `claim(sig)` — requires a transaction signature from `linkPk` (the per-link
  claim code). Signature covers the outputs → mempool front-run safe.
- `refund(sig)` — requires `tx.time >= refundAfter` plus a signature from the
  funder-held `refundPk`.

No covenant state, no output bindings — the funding output is a plain P2SH
payment (see Research Findings #1/#2 in the design doc).

## Toolchain (pinned)

- Compiler: `kaspanet/silverscript`
- Commit: `d25bd3427a093c17327ca3d6b9e1aa5f7688c863`
  ("Bump rusty-kaspa version to v2.0.1", 2026-06-28 — the last commit before
  Toccata mainnet activation)
- Script engine used by the compiler's tests/debugger: `kaspa-txscript` from
  rusty-kaspa **`tag = v2.0.1`** — the same engine the Toccata mainnet release
  runs. Local execution therefore exercises the real mainnet script engine.
- Upstream README still says compiled scripts are "valid only on Kaspa
  Testnet 12"; that note predates mainnet activation and is being clarified
  upstream. Until confirmed, treat mainnet byte-validity as plausible but
  unverified (see "Mainnet fast path" in the design doc).

## Build (on the lab host, Docker)

The compiler is built in a memory-capped container so a build OOM can never
touch the production stack:

```sh
git clone https://github.com/kaspanet/silverscript /opt/silverscript-lab
cd /opt/silverscript-lab && git checkout d25bd3427a093c17327ca3d6b9e1aa5f7688c863

docker run -d --name sil-build \
  --memory=1600m --memory-swap=1600m --cpus=2 \
  -v /opt/silverscript-lab:/work -w /work \
  -e CARGO_BUILD_JOBS=1 -e CARGO_PROFILE_DEV_DEBUG=0 \
  rust:latest cargo build -p cli-debugger
```

## Run plan (local script-engine verification)

1. Copy `claimable_link.sil` into the lab checkout.
2. Execute the claim path in the debugger (argument layout to be confirmed
   against `docs/TUTORIAL.md`):

   ```sh
   cargo run -p cli-debugger -- claimable_link.sil \
     --function claim --ctor-arg <linkPk> --ctor-arg <refundPk> \
     --ctor-arg <refundAfter> --arg <linkSig>
   ```

3. Same for `refund`, both before (must fail) and after (must pass) the
   expiry.
4. Record: compiler commit, SHA-256 of emitted script bytes, and the answers
   to the open questions from the design doc (entrypoint/signatureScript
   layout, `tx.time` semantics, sighash flags, storage mass).

## Results (2026-07)

All six engine tests pass against the pinned toolchain (compiler `d25bd34`,
kaspa-txscript **v2.0.1** — the Toccata mainnet release engine, executed with
`covenants_enabled: true` to mirror post-activation mainnet):

```
test claim_signature_does_not_survive_output_tampering ... ok
test claim_with_link_key_signature_passes ... ok
test claim_with_unrelated_key_fails ... ok
test refund_after_expiry_passes ... ok
test refund_before_expiry_fails ... ok
test refund_key_cannot_use_claim_path ... ok
```

What this proves: the contract compiles, the claim path accepts only the link
key, the refund path enforces the expiry and the refund key, and a valid claim
signature does **not** survive output tampering — the mempool front-run
protection works at the script-engine level.

What this does not prove (needs the canary / a real node): consensus-level
`lock_time` enforcement against the actual DAA score, storage-mass/fee
acceptance, and mempool relay behavior.

## Mainnet Canary

[`claimable_canary.rs`](./claimable_canary.rs) is a separate operator-only
canary harness. It can generate a mainnet P2SH funding address, locally preflight
a claim/refund spend, and print submit JSON for manual broadcast.

## Web UI ScriptBuilder Contract

[`claimable_ui_scriptbuilder_tests.rs`](./claimable_ui_scriptbuilder_tests.rs)
tests the separate hand-built ScriptBuilder contract currently used by
`/toccata-lab`. This matters because the six Silverscript tests above prove the
compiled `claimable_link.sil` artifact, while the web UI intentionally uses a
direct lab script:

```text
IF <claim x-only pubkey> CHECKSIG
ELSE TX_LOCK_TIME <refund after DAA> GREATERTHANOREQUAL VERIFY <refund x-only pubkey> CHECKSIG
ENDIF
```

Run it in the same pinned checkout:

```sh
cp labs/claimable-script/claimable_ui_scriptbuilder_tests.rs \
  /opt/silverscript-lab/silverscript-lang/tests/claimable_ui_scriptbuilder_tests.rs
cd /opt/silverscript-lab
cargo test -p silverscript-lang --test claimable_ui_scriptbuilder_tests
```

Expected coverage:

- exact UI redeem-script bytes match the TypeScript fixture
- claim with the link key passes
- claim still passes at/after the refund lock time (documents the current app-enforced cutoff)
- unrelated-key claim fails
- refund after expiry passes
- refund before expiry fails
- refund key cannot use the claim path
- claim key cannot use the refund path
- claim and refund signatures do not survive output tampering

Result (re-run 2026-07-11, pinned checkout `d25bd34`, Docker `rust:latest`):

```text
running 10 tests
test ui_claim_branch_still_passes_after_refund_lock ... ok
test ui_claim_key_cannot_use_refund_path ... ok
test ui_claim_signature_does_not_survive_output_tampering ... ok
test ui_claim_with_link_key_signature_passes ... ok
test ui_claim_with_unrelated_key_fails ... ok
test ui_refund_after_expiry_passes ... ok
test ui_refund_before_expiry_fails ... ok
test ui_refund_signature_does_not_survive_output_tampering ... ok
test ui_refund_key_cannot_use_claim_path ... ok
test ui_scriptbuilder_bytes_match_web_fixture ... ok

test result: ok. 10 passed; 0 failed
```

This closes the review gap for the current lab UI. Production claimable links
still need a single reviewed artifact strategy before leaving the operator-only
lab.

## Batch Allocator Contract

[`claimable_batch_allocator_tests.rs`](./claimable_batch_allocator_tests.rs)
pins and executes the one-time batch funding contract used by
`/toccata-lab/batch`. The harness verifies that activation requires its
browser-held key and creates exactly the committed child amounts and script
public keys from exactly one input. Changed amounts, destinations, output
counts, input counts, and unrelated signatures are rejected. It also verifies
that the unactivated whole-batch refund requires the refund key and the DAA
lock time.

The activation branch has no cryptographic upper time bound. The application
therefore checks current mainnet DAA both in the browser and immediately before
the server relays a signed activation. At expiry, only the whole-batch refund
flow remains available.

This is not the same safety profile as the engine tests above:

- use only tiny amounts you are willing to lose
- do not reuse canary addresses
- keep `./canary/*.env` files private; they contain lab claim/refund keys
- the harness itself does not talk to the network, but the printed JSON can move
  funds if you submit it manually
- `200000` sompi is now the default fee when omitted from claim/refund
  commands; the minimal
  claim script used 100,293 script units on mainnet, so the harness commits a
  v1 compute budget of 11 and the relay fee must cover the resulting compute
  mass
- submit v1 canaries through the current `kaspa-wasm` wRPC SDK path. The
  public REST proxy observed on 2026-07-04 still required legacy `sigOpCount`
  while the node correctly expects v1 `computeBudget`.
- use `/toccata-lab` as the product-flow prototype for create → fund → share →
  claim/refund. The UI previews fee, net output, expiry, derives an
  experimental one-time P2SH funding address from browser-held secrets, and
  unlocks sharing only after exact on-chain funding is detected. It signs
  claim/refund Transaction SafeJSON in the browser and can relay the signed JSON
  through the lab broadcast endpoint after an explicit operator click. The
  temporary share URL points back to `/toccata-lab#lab-claim=...`, so the
  receiver preview can be loaded without a dead `/claim/...` placeholder route.
  It no longer exposes shell commands as the creator-facing experience.

## Rules

- Engine tests: no funds. The canary harness: tiny mainnet funds only when the
  operator deliberately funds the printed address and manually submits the JSON.
- Findings are recorded in `docs/claimable-links-lab.md`, not here.
