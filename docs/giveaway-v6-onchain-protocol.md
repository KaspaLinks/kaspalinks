# Giveaway V6 — on-chain entries and draw

## Objective

V6 removes KaspaLinks from every trust-critical Giveaway decision while keeping the public flow to:

1. open the shared link;
2. enter a Kaspa address;
3. complete the human check;
4. wait for an on-chain confirmation.

The participant does not pay, connect a wallet, create a KaspaLinks account, or save recovery data. The Creator funds the prize and a bounded execution budget in one Kaspium payment.

## Protocol invariants

1. A participant is shown as accepted only after an Entry Shard transition is accepted on Kaspa L1.
2. Every transition increments the shard count and updates both its ordered entry root and exact-address set root.
3. A payout-script commitment maps to one deterministic shard and cannot be inserted twice.
4. The freeze transaction consumes the Prize State and every funded Entry Shard. A shard cannot be omitted and an unrelated UTXO cannot be inserted.
5. Freeze is invalid before the committed closing DAA. Registrations accepted after that DAA are not eligible for the frozen draw state.
6. The frozen participant set cannot change.
7. The entropy target is committed before entries open.
8. The draw accepts only the first selected-chain block whose score crosses that target, proven against a committed verifier image. KaspaLinks cannot choose another valid block.
9. The winner index is computed inside SilverScript from the proven sequence commitment and frozen entries.
10. The payout transaction can send the exact prize only to that entry. Unused execution budget can return only to the committed Return Address.
11. Empty and timed-out Giveaways return funds keylessly to the committed Return Address.

## Covenant family

### Bootstrap

The Creator sends one exact Kaspium payment to a bootstrap P2SH address. A keyless activation spend fans it out into:

- one Prize State output;
- a small fixed number of indexed Entry Shard outputs;
- no operator-controlled output.

The activation transaction fixes the prize, closing DAA, entropy target, Return Address, maximum confirmed entries, per-transition budgets, Entry Shard template, and entropy verifier image.

Prize State and Entry Shards share one native covenant ID. Activation creates
the entire small indexed family in one transaction. Registration preserves a
shard's lineage, and the freeze leader requires the exact family cardinality
and index sequence. A database row or lookalike P2SH output cannot join that
family.

### Entry Shards

Each Entry Shard starts with the canonical empty roots and carries part of the Creator's transaction budget. The payout-script hash selects a shard. Registration supplies an append proof for the next ordered leaf and a sparse-set non-membership proof for the same hash. The covenant verifies both old roots, computes both new roots, increments the count, and deducts only the fixed entry fee. The browser builds the complete keyless transaction and automatically retries against the new shard tip after a race. KaspaLinks can relay the bytes, but a successful registration is identified by its Kaspa transaction ID and resulting shard UTXO.

The current prototype caps the family at four Entry Shards. This avoids a single global mutable UTXO without creating one storage-mass-heavy output per possible participant, and it keeps the complete freeze witness inside Toccata's transaction bounds. Registrations confirm in parallel across shards, and the participant page can show `Confirmed on Kaspa` with the transaction ID, shard number, and entry index rather than treating a database write as entry.

Turnstile remains a UX and abuse-control layer. It is not part of the draw proof and cannot authorize list changes after an Entry Shard transition confirms. No protocol can prove unique humanity from a Kaspa address alone; stronger Sybil resistance would require an external identity issuer, participant payment, or a wallet signature.

### Freeze

Each Entry Shard carries at most one pending entry commitment. Its successor transaction can finalize that entry only when the consumed shard output's on-chain DAA score is at or before the committed close. After closing, a keyless transaction consumes the Prize State plus every indexed Entry Shard. The leader covenant enforces the absolute DAA lock, verifies the full shard count and index set, applies the same DAA rule to each pending entry, and creates one frozen Prize State containing the complete ordered-root vector and count vector. A pending entry confirmed after closing is excluded even if KaspaLinks delayed the freeze transaction.

Because every shard tip must be consumed, neither KaspaLinks nor the Creator can silently remove a confirmed entry. The public history of each shard reconstructs the same roots and counts from activation through freeze.

The shard prototype performs append and exact duplicate checks directly in
SilverScript. A proof-bound aggregation remains an optimization option if
measured entry fees or witness size require it.

### Entropy proof and draw

`OpChainblockSeqCommit(blockHash)` proves that a supplied block is a recent selected-chain block, but by itself it lets the submitter choose among valid blocks. V6 therefore commits a RISC Zero image ID and verifies a proof whose journal binds:

- Giveaway parameters and frozen entries root;
- target blue score;
- candidate block hash and selected-parent hash;
- candidate and parent blue scores;
- candidate sequence commitment.

The guest verifies the Kaspa header hashes, selected-parent relationship, `parent score < target <= candidate score`, and journal encoding. SilverScript independently evaluates `OpChainblockSeqCommit` for the committed candidate and checks the returned sequence commitment. The first crossing block is consequently unique, while the prover remains replaceable and untrusted.

The selected-parent check cannot rely on an RPC label. The guest receives the
candidate's complete direct-parent header set, recomputes every header hash,
and applies Kaspa's blue-work/hash parent ordering. The journal commits both
the resulting selected-parent hash and candidate hash. SilverScript anchors
both hashes with `OpChainblockSeqCommit`; the score-crossing statement is then
about two adjacent selected-parent-chain blocks rather than two
operator-selected blocks.

The draw hashes the proven commitment with the frozen shard roots and counts, calculates one global winner index, maps it to a shard and local index, verifies the winner's Merkle inclusion proof, and validates the exact winner output. The current contract uses the Kaspa RISC Zero Groth16 verifier with a constructor-pinned guest image ID. The compact proof is supplied by an untrusted prover; a proof for a different guest or journal fails on L1. The KIP-21 sequence-commitment accessor retains only the recent selected-chain window, currently described as roughly twelve hours, so proof generation and draw submission must run promptly after the target block. A failed or unavailable prover cannot redirect funds; after the committed fallback deadline anyone can execute the keyless return.

The payout transaction has exactly two outputs: the exact prize to the proven winner script and all unused execution reserve, minus the fixed draw fee, to the committed Return Address. The keyless return has exactly one output to that Return Address. An empty frozen Giveaway can return immediately at close; a non-empty Giveaway can return only at its precommitted fallback DAA.

## Funding and fees

The setup screen must show one total before the Creator funds:

`prize + shard execution budgets + activation/freeze/draw/return budget`

Every confirmed registration consumes one fixed fee from its shard. Freeze consolidates the remaining shard value. The draw returns unused execution budget to the committed Return Address. The UI presents this reserve separately from the prize and explains that unused reserve returns automatically.

The current four-shard prototype was measured with exact Toccata compute budgets. Activation uses 60,949 compute mass and 179,196 transient mass. Registration uses 91,111 compute mass and 180,164 transient mass. A complete freeze with Prize State plus all four shards uses 168,511 compute mass and 618,564 transient mass. All three fit the current post-Toccata Mainnet limits of 500,000 compute mass and 1,000,000 transient mass. The compiled Entry Shard redeem script is 37,164 bytes and the Prize State is 10,252 bytes. Storage mass with production values, relay fees, and the proof-bearing draw transaction still require end-to-end measurement before funding is enabled.

## Mobile experience

### Creator

1. Choose title, prize, duration, participant cap, and Return Address.
2. Review the exact prize and maximum execution budget.
3. Scan one Kaspium QR code.
4. Share after activation confirms.
5. Receive automatic winner or return notifications.

### Participant

1. Open the Giveaway link in Telegram, Safari, Chrome, or an in-app browser.
2. Enter the payout address and complete the human check.
3. The page selects the deterministic shard, fetches and locally verifies its proofs, builds and relays the keyless transition, and automatically resolves shard races.
4. `Entry confirmed on Kaspa` shows the transaction ID, shard, and entry number.
5. The same link later shows the frozen list proof, entropy proof, winner, and payout transaction.

## Source of truth

PostgreSQL is an index and cache. It may store titles, presentation data, observed transactions, and notification state. A database row alone never constitutes an entry, frozen list, winner, payout, or return. Those statuses are projections of accepted Kaspa transactions.

## Current implementation status

The feasibility contracts and 13 production-direction TxScript-engine tests currently cover exact activation, keyless shard registration, deterministic shard choice, full 256-bit duplicate payout-commitment rejection, late-entry exclusion, complete-family freeze, the absolute close lock, empty return, and fallback return. The Prize State also compiles the proof-bound draw path, reconstructs the frozen shard commitment, derives the winner, verifies Merkle inclusion, and constrains both payout outputs.

A successful real draw is intentionally not claimed yet. It still requires the reproducible entropy guest and a proof fixture for the exact committed journal. Mainnet creation remains disabled until the delivery gates below pass.

## Delivery gates

V6 must not accept Mainnet funding until all of these pass:

- SilverScript engine tests for activation, parallel shard registration, shard races, complete freeze, duplicate rejection, draw, empty return, and timed return;
- proof-bearing draw, contextual storage-mass, and relay-fee measurements at the maximum cap;
- a reproducible RISC Zero guest and proof pipeline whose image ID is pinned in source;
- independent browser verification of the same journal and winner calculation;
- restart and index-rebuild tests using only chain data;
- a restricted low-value Mainnet activation, registration, draw, and return trial;
- external review of the covenant and entropy guest.

## Primary Kaspa references

- [KIP-20 covenant IDs and contexts](https://github.com/kaspanet/kips/blob/master/kip-0020.md)
- [KIP-16 on-chain ZK verification](https://github.com/kaspanet/kips/blob/master/kip-0016.md)
- [SilverScript covenant declarations](https://github.com/kaspanet/silverscript/blob/master/docs/DECL.md)
- [SilverScript and transaction introspection](https://github.com/kaspanet/docs/blob/main/content/docs/toccata/silverscript.mdx)
- [KIP-21 lanes and proof-bound settlement](https://github.com/kaspanet/docs/blob/main/content/docs/toccata/based-apps.mdx)
- [KIP-21 sequencing commitment specification](https://github.com/kaspanet/kips/blob/master/kip-0021.md)
- [KIP-21 seqcommit accessor limits](https://github.com/kaspanet/kips/blob/master/kip-0021/seqcommit-accessor.md)
- [Toccata implementation map](https://github.com/kaspanet/docs/blob/main/content/docs/toccata/references.mdx)
