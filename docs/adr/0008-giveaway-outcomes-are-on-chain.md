---
status: accepted
---

# Giveaway outcomes are on-chain

New Giveaways will treat Kaspa L1, rather than PostgreSQL or a KaspaLinks signing key, as the source of truth for accepted entries, the closed participant set, the randomness rule, and the payout. The Creator prepays a bounded execution budget across a small fixed set of Entry Shards so a participant can enter from a mobile browser without paying, connecting a wallet, or creating an account. Every confirmed registration updates an append-only entry root, an exact-address set root, and a count on one shard. The payout commitment deterministically selects its shard, so the same address cannot evade the duplicate check through another shard. KaspaLinks may verify a human challenge, build or relay a transaction, and produce an Entropy Proof, but the covenant must reject omitted on-chain state, duplicate payout commitments, late entries, a substituted randomness block, a changed winner, and a redirected payout.

Existing V3–V5 outputs remain supported until they settle. New creation moves to this protocol only after complete engine tests, transaction-mass measurements, a reproducible entropy prover, and a funded restricted Mainnet trial. Human uniqueness remains an admission problem: an L1 covenant can reject the same payout commitment twice, but cannot prove that one person controls only one address.

## Considered options

- Keeping platform attestations gives the easiest implementation but leaves list and block selection under one operator key.
- Requiring every participant to pay or sign with a compatible wallet is simpler on chain but breaks the Kaspium-first mobile experience.
- One creator-funded UTXO per possible participant gives parallel writes, but a large fanout incurs high storage mass, binds too much reserve, and forces a hard cap before demand is known.
- A single append-only UTXO minimizes reserve but serializes every registration.
- A small fixed shard set preserves free, walletless entry, supports parallel confirmations, and keeps the reserve tied to actual execution budget rather than one output per potential participant.

## Consequences

The protocol needs a covenant family rather than one prize script: bootstrap funding, parallel Entry Shards, a DAA-locked complete freeze transition, proof-bound draw, and keyless return. The funded maximum entry count and execution budget are part of the terms, while only a small constant number of UTXOs is created. KaspaLinks must not market a Giveaway as operator-independent until the Entropy Proof and full-shard freeze are enforced by the deployed script.
