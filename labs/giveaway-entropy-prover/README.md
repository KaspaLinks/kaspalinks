# Giveaway entropy prover

This lab workspace contains the reproducible RISC Zero guest for Giveaway V6.
It proves that two supplied post-Toccata Kaspa headers are a selected-parent
pair and the first pair whose blue score crosses the Giveaway's committed
target. The journal is byte-for-byte identical to the journal reconstructed by
`GiveawayPrizeShardsV6.draw`.

The prover is untrusted and holds no wallet keys or funds. Kaspa L1 accepts a
draw only when the compact proof verifies against the constructor-pinned image
ID and the on-chain sequence commitments for both recomputed block hashes.

Pinned build tools:

- RISC Zero zkVM/build crates and `cargo-risczero`: `3.0.4`
- RISC Zero Groth16 JSON decoder: `3.0.5`
- RISC Zero guest Rust toolchain: `1.88.0` (`r0.1.88.0` upstream artifact)
- rusty-kaspa header format: `a41a333b08848f41bf737b72592e463a6011b8ac`

Pinned guest image ID:

```text
a402f88f9b89afd2eb5e5f6cdc96f67af2ff4d4da70e1e6a4767a99c26b692b1
```

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
VM with enough memory. The verified fixture was produced in a 16 GiB x86_64
QEMU VM with RISC Zero's `risczero/risc0-groth16-prover:v2025-04-03.1`
image. The resulting proof JSON is stored at
`host/tests/fixtures/groth16_proof.json` and is verified during the normal
workspace test run.

Regenerate the compact Borsh receipt consumed by the SilverScript engine test:

```sh
cargo run -p giveaway-entropy-host --example export_fixture -- \
  ../claimable-script/fixtures/giveaway_entropy_v6_groth16.rcpt
```

The pinned fixture hashes are:

```text
Groth16 proof JSON  8c1942a0aeb2bdaec47665cee8aada1182b50dc70f364c6db928eb5a23df8fd2
Borsh receipt       a248783b8bc148a1a71352928d3bc0798a9c2922acd513a11ffa239382138248
```

The final SilverScript test independently verifies the receipt, converts it to
Kaspa's compact TxScript proof format, reconstructs the exact journal, anchors
both header commitments through `OpChainblockSeqCommit`, and executes the draw
against the real post-Toccata script engine.
