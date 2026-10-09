# Giveaway V6 chain reconstruction

The V6 participant list and draw result are reconstructed from accepted Kaspa
transactions. PostgreSQL may cache the result for the UI, but it is not an
authority for registrations, eligibility, the frozen root, or the winner.

## Trust boundary

`@kaspa-actions/kaspa-indexer` now exposes a pure
`reconstructGiveawayV6(config, events)` state machine. Its input is a
topologically ordered stream of decoded, accepted covenant transitions. It:

- follows the prize and every shard outpoint from the activation transaction;
- derives each registration commitment from the payout script;
- enforces deterministic shard selection and rejects duplicate commitments;
- reproduces the pending-entry rule at the closing DAA score;
- recomputes every ordered entry root, sparse address root, frozen root, and
  frozen entry count;
- checks the draw's entropy-score boundary and recomputes the global winner;
- verifies that draw and return outputs use the scripts committed before
  funding; and
- emits decimal strings instead of JavaScript numbers for DAA values at JSON
  boundaries.

The JSON parser is strict. It rejects unknown fields, numeric or
scientific-notation DAA values, oversized uint64 values, malformed hashes,
malformed scripts, and unexpected transition shapes. It does not accept keys,
seeds, credentials, or signed transaction material.

## Required chain decoder

The VSPC v2 adapter now reads `GetVirtualChainFromBlockV2` with `Full`
verbosity from a Kaspa RPC client. It checks the configured network, requests a
confirmation distance (ten by default), normalizes accepted transaction
inputs, previous UTXOs, output covenant bindings, signature scripts, and the
accepting header, and exposes removed-chain hashes for cache rollback. The
adapter rejects partial responses instead of inventing missing UTXO context.

The remaining SilverScript ABI decoder must turn those normalized
transactions into protocol events only after checking all of the following:

1. The transaction is accepted and belongs to the requested network.
2. The activation redeem scripts commit to the supplied giveaway ID, closing
   score, return score, entropy target, tree configuration, return script, and
   exact V6 prize/shard family.
3. Each transition consumes the current family outpoint and its signature
   script decodes to the expected SilverScript ABI method and arguments.
4. Registration payout scripts come from the on-chain witness, and transition
   DAA scores come from the created UTXO rather than a local clock.
5. Freeze state comes from the frozen prize output and draw data comes from the
   accepted draw transaction plus the referenced public block headers and
   sequence commitments.
6. A rebuild discards events that are no longer accepted and replays the
   surviving lineage from activation.

The decoder must not fill gaps from the database. A missing or ambiguous
transaction leaves the public status unverified until chain data is available.

## Current verification

The TypeScript reconstructor is checked against the same 12-participant fixture
as the SilverScript engine tests. It reproduces frozen root
`a8780ddf4e63d1779828849df0c56c67703f0a29ebe0df70b233eebb05149f10`
and, with the captured Mainnet header pair, global winner index 5, shard 1,
local index 2. Tests also cover duplicate registration, wrong shard, broken
lineage, mismatched frozen state, late pending exclusion, redirect attempts,
fallback return, strict JSON validation, and deterministic rebuilds.

## Production sequence

1. Connect the vendored Kaspa SDK to the private Hetzner node and add the V6
   SilverScript ABI decoder on top of the completed VSPC v2 adapter.
2. Run reconstruction as an idempotent worker and store only derived snapshots
   plus the last verified chain position.
3. Expose the snapshot and its transaction/header references through a
   read-only verification endpoint.
4. Render the same proof in the creator studio, public giveaway page, and
   Telegram Mini App.
5. Run restart, reindex, reorg, empty-giveaway, late-entry, draw, and fallback
   return canaries before enabling V6 funding for additional accounts.

The RPC shape follows the official
[`GetVirtualChainFromBlockV2` release specification](https://github.com/kaspanet/rusty-kaspa/releases/tag/v1.1.0)
and the canonical
[`RpcTransaction`/`RpcUtxoEntry` protobuf definitions](https://github.com/kaspanet/rusty-kaspa/blob/master/rpc/grpc/core/proto/rpc.proto).
