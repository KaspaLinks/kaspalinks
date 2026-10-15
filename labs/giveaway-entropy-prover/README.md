# Giveaway entropy prover

This lab workspace contains the reproducible RISC Zero guest for Giveaway V6.
It proves that two supplied post-Toccata Kaspa headers are a selected-parent
pair and the first pair whose blue score crosses a committed target. The
journal is byte-for-byte identical to the journal reconstructed by
`GiveawayPrizeShardsV6.draw`.

The journal holds the target and both blocks, and nothing Giveaway-specific.
Every Giveaway committed to the same draw slot shares the target, so one
receipt serves all of them; each still derives its own winner because the
draw digest mixes in its id and frozen participant root separately. Proof
jobs are therefore keyed by the target alone.

The prover is untrusted and holds no wallet keys or funds. Kaspa L1 accepts a
draw only when the compact proof verifies against the constructor-pinned image
ID and the on-chain sequence commitments for both recomputed block hashes.

Pinned build tools:

- RISC Zero zkVM/build crates and `cargo-risczero`: `3.0.4`
- RISC Zero zkVM Groth16 receipt format: `3.0.4`
- RISC Zero guest Rust toolchain: `1.88.0` (`r0.1.88.0` upstream artifact)
- rusty-kaspa header format: `a41a333b08848f41bf737b72592e463a6011b8ac`

Pinned guest image ID:

```text
8d405aec6ae72a8a2bba7ed56620c85973c555599b52403187f40c6891d44d3b
```

The guest is always built inside RISC Zero's builder container
(`risczero/risc0-guest-builder:r0.1.88.0`, set in `methods/build.rs`). A host
build embeds the builder's absolute Cargo and source paths into the ELF, which
made the earlier pinned ID reproducible only on the machine that produced it.
Inside the container every path is fixed. This ID was rebuilt independently on
an x86_64 Linux machine and in an x86_64 VM on Apple Silicon, with identical
ELF bytes.

Building therefore needs Docker with the `buildx` plugin, because `risc0-build`
exports the ELF with `docker build --output`. Ubuntu's `docker.io` package does
not ship `buildx`; install `docker-buildx` or the plugin from the upstream
release.

Run the deterministic core checks with:

```sh
cargo test -p giveaway-entropy-core
cargo test --workspace
```

Building `giveaway-entropy-methods` compiles the guest and emits its image ID.
Producing a local composite receipt uses `giveaway_entropy_host::prove`.
Groth16 compression requires the matching RISC Zero Groth16 environment and is
kept outside the web application.

The ignored Groth16 test exercises the full prover when the RISC Zero Docker
prover is available:

```sh
cargo test -p giveaway-entropy-host \
  produces_and_verifies_a_groth16_receipt -- --ignored --nocapture
```

On Apple Silicon, the official Groth16 image currently needs an x86_64 Docker
VM with enough memory. The verified fixture is produced in a 16 GiB x86_64
QEMU VM with RISC Zero's `risczero/risc0-groth16-prover:v2025-04-03.1`
image. Set `RISC0_WORK_DIR` to a path shared with that VM; Colima does not
mount macOS's default `/var/folders` temporary directory.

Regenerate the compact Borsh receipt consumed by the SilverScript engine test
from the pinned public Mainnet header pair and twelve-participant fixture:

```sh
mkdir -p "$HOME/.cache/kaspa-groth16"
RISC0_WORK_DIR="$HOME/.cache/kaspa-groth16" \
  cargo run -p giveaway-entropy-host --example prove_fixture -- \
  ../claimable-script/fixtures/giveaway_entropy_v6_mainnet_groth16.next.rcpt
```

Capture a new public Mainnet pair for an already committed target score with:

```sh
node scripts/fetch-mainnet-pair.mjs \
  --target TARGET_BLUE_SCORE \
  --output /path/to/new-mainnet-pair.json
```

`scripts/fetch-mainnet-pair.mjs` captures a public selected-parent transition
from Kaspa wRPC and writes it with create-new semantics. Before proving, the
host independently rehashes both headers, checks the selected-parent link and
target crossing, reconstructs all shard roots, and derives a nontrivial winner.
The deterministic participant generator creates structurally valid public
P2PK fixture scripts without storing private keys. Those keys have no known
owner and are test data only; a funded canary must use real participant payout
addresses while signing remains in each participant's wallet.

Pinned public fixture hashes:

```text
Mainnet header pair  837136a1a4d0a71953de19dede0fcef3ec13d85d522977948afc1bc9b152a1b9
Participants         43ffa14e8e719019696b631a92a4a3e84b9144bbbf6cac57fca256a5cb8195c4
Groth16 receipt      12776db32c8e5fd8f7886a2b043e08900bcec9669609c06855ee777c2dd0b005
```

The final SilverScript test independently verifies the receipt, converts it to
Kaspa's compact TxScript proof format, reconstructs the exact journal, anchors
both header commitments through `OpChainblockSeqCommit`, and executes the draw
against the real post-Toccata script engine.
