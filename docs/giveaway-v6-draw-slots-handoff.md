# Giveaway V6: fixed draw slots and a shared entropy proof

Status: proposal for the V6 owner. Nothing in this document has been implemented. No repository file other than this one was changed.

## Decision

Giveaways end only at fixed draw slots, every six hours on the UTC clock: 00:00, 06:00, 12:00 and 18:00 UTC. The creator picks a slot in the UI, which shows it in the viewer's local time. One entropy proof is computed per slot and used by every Giveaway of that slot.

This caps proving at four proofs per day regardless of how many Giveaways exist. At the measured duration below that is roughly 1.6 hours of prover time per day on one machine. Slots without a Giveaway are never proven.

In Germany the slots appear as 02:00, 08:00, 14:00 and 20:00 in summer time, and one hour earlier in winter.

## Why the proof is per Giveaway today

The proof attests one fact about the chain: which selected-chain block first crosses a target blue score. That fact is the same for every Giveaway with the same target.

It is computed per Giveaway only because two Giveaway values are written into the journal:

- `labs/giveaway-entropy-prover/core/src/lib.rs`, `journal()`: writes `giveaway_id` and `frozen_root`. The guest checks only that they are non-zero and otherwise passes them through.
- `labs/claimable-script/giveaway_prize_shards_v6.sil`, entry `draw`: reconstructs `journalHash` with `giveawayId` and `frozenRoot`.

The winner does not depend on that binding. `drawDigest` in the same entry is computed separately from `giveawayId`, `frozenRoot`, `candidateBlockHash` and `candidateSeqCommit`, so each Giveaway of a slot still gets its own winner from a shared proof.

The participant list cannot be influenced by freeze timing either. `freeze` admits only registrations whose input DAA score is at most `closesAtDaa`, so the frozen root is fully determined by on-chain entries at the close, whether the freeze lands before or after the entropy block.

## Proposed changes

### Journal and covenant

1. `core/src/lib.rs`: drop `giveaway_id` and `frozen_root` from `journal()`. `JOURNAL_LENGTH` goes from 217 to 153 bytes. Use a new journal domain byte so the old and new formats cannot be confused.
2. `giveaway_prize_shards_v6.sil`, `draw`: drop `giveawayId` and `frozenRoot` from `journalHash` and match the new domain byte. Leave `drawDigest` unchanged.
3. Review explicitly whether anything relies on the journal binding. My reading found nothing, but it was a reading, not a test.

### Canonical slot terms

Today `buildGiveawayV6CreationTerms` in `apps/web/src/lib/giveaway-v6-creation.ts` derives the target from the creator's own moment:

```ts
const closesAtDaa = input.chain.daa + durationDaa;
const entropyTargetBlueScore = input.chain.blueScore + durationDaa + 60s * DAA_PER_SECOND;
```

Two Giveaways for the same slot created at different times therefore commit different targets and cannot share a proof. Each slot needs canonical terms that are fixed once and reused by every Giveaway of that slot:

- slot start in UTC
- `closesAtDaa`
- `entropyTargetBlueScore`, keeping the 60-second entropy delay after the close
- `returnAtDaa`, keeping the 24-hour return delay

Persist them in a record keyed by the slot start, created when the slot first becomes selectable and never recomputed after that. A funded covenant commits these values as constructor arguments, so a later recomputation would split the slot.

The chain counts blocks, not seconds, so a slot predicted up to 24 hours ahead closes within some seconds or minutes of its nominal time. Show the slot as approximate.

### Prover pipeline

- One proof job per slot, keyed by `entropyTargetBlueScore`, instead of one per Giveaway.
- The worker draws every Giveaway of the slot with the same compact proof.
- The 12-hour sequence-commitment window is unaffected: a slot proof finished about 25 minutes after the slot covers all of its Giveaways.

### Rules

- Entries close at the slot itself. Participants see one time, and the covenant already excludes registrations confirmed after `closesAtDaa`, so no extra buffer is needed before the draw.
- A slot can be chosen for a new Giveaway until 30 minutes before it. This leaves time to fund and activate, and guarantees at least 30 minutes of entries.
- At most 24 hours ahead, which is at most the next four slots.
- A slot is proven only if at least one of its Giveaways has at least one participant. A Giveaway without entries never needs a proof: `draw` requires `entryCount > 0`, and the empty family takes the return path at the close.

### Creation studio

`apps/web/src/app/giveaway/new/GiveawayV6Studio.tsx`:

- Replace the `DURATIONS` presets (15 min, 1 hour, 6 hours, 24 hours) with a slot picker listing the selectable slots in local time, each with its UTC time and the time remaining, for example `Today 20:00 (18:00 UTC) · in 3 h 12 min`.
- Replace the `duration` URL preset with a slot parameter, and send the chosen slot instead of `durationSeconds` to the creation API. The server resolves the canonical slot terms and rejects a slot that is closer than 30 minutes, already past, or more than 24 hours ahead.
- Place this note under the picker:

  > Entries close at the time you pick. Kaspa then locks the participant list, KaspaLinks proves the random block, and the winner is paid automatically, usually within about 30 minutes. If nobody entered, the prize returns to you.

### Public Giveaway page

`apps/web/src/app/giveaways/[id]/V6GiveawayView.tsx`:

- Open phase: `Entries close {local time} ({UTC time})`, followed by `After that, the list is locked on Kaspa, the random block is proven and the winner is paid automatically, usually within about 30 minutes.`
- Step 3 detail: `Paid automatically, usually about 30 minutes after close` instead of `Automatic after close`.
- Frozen phase: keep the heading `Entries locked · drawing winner` and replace the body with `The participant list is locked on Kaspa. KaspaLinks is proving the random block now; the winner is expected around {close + 30 min}. Nobody can change the list or redirect the prize.`

The 30 minutes come from the measured home prover: about 24 minutes of proving plus the 60-second entropy delay, confirmation and the draw transaction. Revisit the wording once proving runs on its final machine.

### Telegram

`apps/web/src/app/api/agent/telegram/webhook/route.ts`:

- `/giveaway <KAS prize> <duration> <title>` takes a duration that no longer exists. Drop it and let the creator choose the slot in the Mini App. Picking times in a group chat across time zones invites mistakes.
- Update the help texts that say `duration up to 24h` and the example `/giveaway 0.5 24h Weekend KAS`.

### Why the horizon stays at 24 hours

A Giveaway ending two days after creation is attractive for Telegram groups, but the current 24-hour maximum protects something that should not be given up silently.

Pruned Kaspa nodes keep block data for about 30 hours (`PRUNING_DURATION = 108_000` seconds in `consensus/core/src/config/constants.rs` at the pinned rusty-kaspa revision). The reconstruction replays a Giveaway's lineage from activation, and it must not fill gaps from the database. With activation at most 24 hours before the close, an ordinary pruned node still holds the whole lineage until about six hours after the close. That keeps two things possible:

- anyone can independently verify the entries and the result with a normal node, and
- KaspaLinks can rebuild a projection from chain data after a database loss or a reorg that removes the anchor.

A longer participation window loses both once the activation data is pruned. Funds stay safe, because the keyless return still applies, but the Giveaway can fail and its entries become unverifiable without an archival node.

An announcement phase, created and shared further ahead with entries opening only within the last 24 hours, was considered and not chosen for now.

## Blocker: the pinned guest image ID is not reproducible

The pinned image ID `a402f88f9b89afd2eb5e5f6cdc96f67af2ff4d4da70e1e6a4767a99c26b692b1` can only be rebuilt on the Mac that produced it. A proof generated from a guest built anywhere else fails on L1.

Evidence, computed with `risc0_zkvm::compute_image_id` on the same machine:

| Guest binary                                                          | Image ID                               |
| --------------------------------------------------------------------- | -------------------------------------- |
| Built on the Mac, `target/riscv-guest/.../giveaway-entropy-guest.bin` | `a402f88f…26b692b1` (the pinned value) |
| Built from the same commit on a Linux x86 machine                     | `27b95477…5e17bdb5`                    |

The guest ELF embeds absolute source paths under the builder's Cargo home, `~/.cargo/registry/src/...` expanded to the full home directory, which differs between the macOS and the Linux account. The image ID therefore depends on the builder's home directory. The README describes the guest as reproducible; it is not.

Consequences: nobody other than this Mac can confirm which source the pinned ID corresponds to, and any second prover must reuse the Mac's binary.

Proposed fix: build the guest with RISC Zero's Docker guest builder, pin the resulting ID, and regenerate the Groth16 fixture. Confirm the ID on two different machines before pinning. The journal change above alters the image ID anyway, so both changes can share one re-pin and one engine-test and canary cycle.

## Measured: proving on a home x86 machine

Machine: a mini PC with an AMD Ryzen 5 5500U (6 cores, 12 threads), 11 GiB usable RAM, Ubuntu 24.04, NVMe swap. A Kaspa mainnet node (`kaspad --utxoindex`, about 7 GB resident) kept running during every measurement.

Workload: `prove_fixture`, the full pipeline up to the compact Groth16 receipt, on the pinned mainnet fixture. The guest was built locally, so its ID differs, which does not affect timing.

|                              | Run 1      | Run 2      |
| ---------------------------- | ---------- | ---------- |
| Wall clock                   | 26:50      | 23:48      |
| Groth16 compression step     | about 20 s | about 20 s |
| Peak resident memory, prover | 7.7 GB     | 8.0 GB     |
| Peak swap use                | 10.7 GB    | 9.1 GB     |
| Node interrupted             | never      | never      |

Run 1 includes the one-time download of `risczero/risc0-groth16-prover:v2025-04-03.1` (5.21 GB). Run 2 is the representative figure.

Execution alone, without proving, takes 0.18 s for 4,442,866 cycles in five segments (four at po2 20, one at po2 19). Nearly all proving time goes to hashing the two headers: they carry 56 parent levels with 241 and 309 parents, about 18 KB hashed with BLAKE2b in the guest.

The Mac pilot's 16 minutes is dominated by the x86 emulation of the Groth16 step. On native x86 that step takes seconds; the STARK phase dominates instead.

## Current state of the home prover

Installed under a user account on that machine, not connected to the application host:

- prover sources from commit `5912165` in `~/kaspalinks-prover`, built with RISC Zero 3.0.4, guest toolchain 1.88.0
- the Groth16 Docker image
- a 16 GB swap file at `/swapfile-prover`

Remaining before it can serve drawings:

1. Use a guest whose image ID matches the pinned one, ideally after the reproducible rebuild above.
2. Run `prove_job` as a service with restart on failure.
3. Connect it like the Mac pilot in `docs/deployment.md`: an outbound reverse SSH tunnel to the restricted `kaspa-prover` account, no inbound port.

Optional: pausing `kaspad` during a proof would remove the swapping. It was not needed in either run and would require a narrowly scoped sudo rule.

## Open questions

- Is there a security reason to keep `giveaway_id` and `frozen_root` in the journal?
- Whether slot terms are created on first use or published on a fixed schedule ahead of time.

Decided by the product owner: six-hour UTC slots, entries closing at the slot, new Giveaways for a slot until 30 minutes before it, and at most 24 hours ahead.
