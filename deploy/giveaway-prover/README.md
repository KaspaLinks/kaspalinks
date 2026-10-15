# Giveaway V6 home prover

Runs the Giveaway V6 entropy prover on a Linux machine outside the application
host and connects it to the agent worker through an outbound SSH tunnel. The
application host has 4 GB of memory and cannot produce a Groth16 proof itself.

The prover handles only public data: a target blue score and two Kaspa block
headers. It never receives wallet, signing or recovery material, and a wrong or
forged proof cannot move funds, because the covenant checks it on chain.

## What one proof costs

Measured on an AMD Ryzen 5 5500U with 16 GB of memory and a pruned `kaspad`
running alongside:

- 24 to 27 minutes per proof, of which about 20 seconds is Groth16 wrapping
  (three runs; the last one was a live job through `prove_job`, from header
  capture to a verified receipt)
- about 8 GB peak resident memory; the proof leans on swap while the node keeps
  its memory, so give the machine at least 16 GB of swap
- one proof per draw slot, never per Giveaway, and none for a slot without
  participants, so at most four proofs a day

## Requirements

- Docker with the `risczero/risc0-groth16-prover:v2025-04-03.1` image pulled
- Rust and the RISC Zero 3.0.4 toolchain (`rzup`), plus the `docker buildx`
  plugin: the guest is built in RISC Zero's Docker builder so that its image ID
  is reproducible
- Node 24 in `~/.local/node` (the official tarball, checked against
  `SHASUMS256.txt`)
- lingering enabled for the service user, once, as root:
  `loginctl enable-linger <user>`, so the user services run without a login

## Install a release

As the service user, from a clone at the commit that is deployed on the
application host:

```bash
release=~/kaspa-giveaway-prover/releases/<commit>
mkdir -p "$release"
git archive <commit> | tar -x -C "$release"
cd "$release"
PATH=~/.local/node/bin:$PATH corepack pnpm install --frozen-lockfile
cd labs/giveaway-entropy-prover
cargo build --release -p giveaway-entropy-host --bin prove_job
cargo test --release -p giveaway-entropy-host --test prover -- \
  image_id_is_pinned verifies_the_pinned_groth16_fixture
ln -sfn "$release" ~/kaspa-giveaway-prover/app
```

The tests check the built guest against the image ID pinned in the contract.
Do not run a prover whose ID does not match: its proofs fail on chain.

## Connect it

1. Create a key used only for the tunnel:
   `ssh-keygen -t ed25519 -N "" -C kaspa-giveaway-prover -f ~/.ssh/id_ed25519_kaspa_prover`.
2. On the application host, append its **public** key to the `kaspa-prover`
   account described in [docs/deployment.md](../../docs/deployment.md) with the
   options `restrict,port-forwarding`.
3. Record the application host's key in `~/.ssh/known_hosts`, checked against
   the host's own fingerprint. The tunnel refuses unknown host keys.
4. Write `~/.config/kaspa-giveaway-prover/tunnel.env`:
   `PROVER_TUNNEL_TARGET=kaspa-prover@<application host>`.
5. Install and start both user services:

   ```bash
   install -D -m 0644 deploy/giveaway-prover/kaspa-giveaway-prover.service \
     ~/.config/systemd/user/kaspa-giveaway-prover.service
   install -D -m 0644 deploy/giveaway-prover/kaspa-giveaway-prover-tunnel.service \
     ~/.config/systemd/user/kaspa-giveaway-prover-tunnel.service
   systemctl --user daemon-reload
   systemctl --user enable --now kaspa-giveaway-prover kaspa-giveaway-prover-tunnel
   ```

The job server listens on `127.0.0.1:3020` only. The tunnel publishes it as
`/var/lib/kaspa-giveaway-prover/prover.sock` on the application host, where the
agent worker reads `GIVEAWAY_V6_PROVER_SOCKET`.

## Check it

- `systemctl --user status kaspa-giveaway-prover kaspa-giveaway-prover-tunnel`
- On the application host, the socket exists and is owned by `kaspa-prover`.
- `journalctl --user -u kaspa-giveaway-prover` shows
  `Giveaway prover listening on 127.0.0.1:3020.`

A disconnected tunnel restarts after ten seconds. It must be up when a slot's
entropy target is reached; until then the worker keeps waiting, and after 24
hours without a draw the covenant's return path pays everything back.

## Update

Install the new release as above, which repoints `~/kaspa-giveaway-prover/app`,
then restart `kaspa-giveaway-prover`. Avoid restarting during a proof: the
worker would wait for the next attempt.
