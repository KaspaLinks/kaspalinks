# Verifiable Giveaway Draw

The private Giveaway Lab uses draw protocol v2 for newly created giveaways. It improves the draw
without changing the non-custodial prize flow.

## Draw sequence

1. The creator browser creates and funds the one-time prize output. Claim and refund keys stay in
   the browser and private recovery file.
2. Each entrant submits a mainnet Kaspa address and receives its deterministic entry hash as a
   receipt.
3. Once entries close, the server sorts all entry hashes and freezes them into a Merkle root.
4. The freeze receipt fixes the entry count, root, precommitted seed hash, and a future Kaspa
   virtual-chain blue-score target before that target block exists.
5. The draw waits until the target has an additional confirmation margin, then selects the first
   confirmed virtual-chain block at or after the target.
6. The final digest commits to the freeze receipt, revealed seed, entropy block hash and block blue
   score. The digest modulo the frozen entry count selects the winner.
7. The public page recomputes the Merkle root, seed commitment, freeze commitment, final digest and
   winning address in the visitor's browser.

## What entrants can verify

- their saved entry hash is present in the frozen manifest;
- the manifest still matches the published Merkle root;
- the revealed draw seed matches the commitment published before entries opened;
- the future entropy block and blue score are part of the final digest;
- the announced winning address hashes to the selected manifest entry.

The first freeze receipt seen by a browser is saved locally. If the root, count, target or freeze
commitment later changes, that browser shows a warning.

## Remaining trust boundary

This protocol makes changes after the participant freeze detectable and removes the server's
ability to know the future chain entropy when it publishes the root. It does not prove that every
Kaspa address belongs to a different person, and it cannot prevent a dishonest operator from adding
addresses before the root is frozen. Turnstile and rate limiting reduce automated abuse but are not
identity proofs.

Moving the participant root and payout state fully on-chain would require a larger covenant or
based-application design. Argent is useful as a state-machine design reference for that future
architecture, but it is not included in the running product while its toolchain is still marked as
early-stage.
