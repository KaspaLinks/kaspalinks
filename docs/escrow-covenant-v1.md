# Escrow Covenant V1 — specification

Status: lab specification for `labs/claimable-script/escrow_v1.sil`, verified against the
real script engine (26 tests in `labs/claimable-script/escrow_v1_tests.rs`). No funded
transaction has been performed. The UI prototype in [escrow-links.md](./escrow-links.md)
assumes this model.

V1 deliberately has **no deposits**. Only the buyer funds the escrow, so a single
covenant output carries the whole deal and no two-party funding is needed. Deposits
are a V2 question.

## Parties and parameters

Two parties: the buyer, who funds, and the seller, who ships.

All deal parameters live in the witness and are bound to the funding output through
one hash, as with the giveaway prize covenant:

```
paramsHash = sha256(amount ‖ fee ‖ releaseAfter ‖ buyerPk ‖ sellerPk
                    ‖ buyerSpkHash ‖ sellerSpkHash)
```

- `amount` (8 bytes, little endian): what the seller receives on a normal release.
- `fee` (8 bytes): the sompi reserved for one spending transaction's fee.
- `releaseAfter` (8 bytes): the DAA score from which the seller can claim.
- `buyerPk`, `sellerPk` (32 bytes each): Schnorr keys for the two parties.
- `buyerSpkHash`, `sellerSpkHash` (32 bytes each): `sha256` of each payout script
  public key, so both P2PK and P2SH payout addresses fit. The spending transaction
  passes the script public key itself and the script checks the hash.

The contract itself takes only `initStateHash`, so every escrow shares one compiled
artifact and one script template.

## States

```
ACTIVE = sha256(0x00 ‖ paramsHash)
FROZEN = sha256(0x01 ‖ paramsHash)
```

Funding pays `amount + fee` into ACTIVE. A freeze moves `amount` into FROZEN and
spends `fee` as the transaction fee, so the settlement pays out `amount - fee`.

## Spend paths

| Entry     | Who signs            | State            | Time                     | What the script enforces                                                          |
| --------- | -------------------- | ---------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `release` | buyer                | ACTIVE           | any                      | exactly one output, `amount` to the seller's script public key                    |
| `refund`  | seller               | ACTIVE or FROZEN | any                      | exactly one output to the buyer: `amount` from ACTIVE, `amount - fee` from FROZEN |
| `claim`   | seller               | ACTIVE           | `tx.daa >= releaseAfter` | exactly one output, `amount` to the seller                                        |
| `freeze`  | buyer                | ACTIVE           | any (see finding below)  | exactly one output of `amount` carrying the same covenant in FROZEN               |
| `settle`  | buyer **and** seller | FROZEN           | any                      | nothing beyond both signatures                                                    |

Why each rule exists:

- **Release binds the output.** The buyer authorizes it, so without an output binding
  the buyer could send the payment back to themselves.
- **Refund binds the output** for the same reason, in the other direction. It stays
  available while frozen, so the seller can always end a dispute in the buyer's favour
  alone.
- **Claim is the deadline path.** It is blocked in FROZEN, so a freeze before the
  deadline takes the unilateral payout away from the seller.
- **Freeze cannot be used to move money.** The only allowed output is the same covenant
  with the same total, in FROZEN.
- **Settle needs no output binding.** Both signatures cover the outputs, so any split
  both parties sign is valid, and neither can move the KAS alone.

## Finding: a time lock can only prove "not before"

The first compile attempt rejected `tx.daa < releaseAfter`. Kaspa time locks compile to
an absolute lock, so a script can require that a spend happens **after** a point in time,
never **before** one. The freeze path therefore has no deadline of its own.

Consequences:

- After `releaseAfter`, `claim` and `freeze` compete for the same output. Whichever is
  mined first wins. A buyer can still freeze late and take the payout away from the
  seller until both agree.
- The seller should claim promptly once the deadline passes, and the buyer should freeze
  as soon as something is wrong. The interface has to say that instead of promising a
  deadline the script does not enforce.
- Nothing here lets either side take the KAS. A late freeze locks the money for both; it
  does not move it.
- Options for V2: a second, later time lock that opens a seller-only path even in FROZEN,
  or deposits that make a late freeze expensive. Both need their own analysis.

## Compiled artifact

Compiled in the lab checkout `3ed9733` ("Prepare SilverScript 1.0"), compiler version
0.1.0, ABI schema 1:

- source `escrow_v1.sil` sha256 `5b4f722497945bed99c4f8106774966e09185710b70ea11bb3b550cfdb006ca0`
- script 962 bytes, sha256 `94eb61eb4e66ed3a1b854f7733216c64fe771650334d37ac5aaa9f4b88a70cbf`
- template hash `7f54b0335bdad1599cbddfc1a2a35f401ed1857ac5c9d89603d83bc8163772d9`
- state span: offset 1, length 33
- dispatch tags: release `8c7728a9`, refund `3198e8f6`, claim `8fd20cef`, freeze
  `11456534`, settle `a4fb823d`

The giveaway prize covenant is 746 bytes for comparison. Compute budget, witness sizes
and fee floors still have to come out of the engine tests.

## Engine test results

`escrow_v1_tests.rs` runs the real `TxScriptEngine` with `covenants_enabled`, the same
engine the Toccata mainnet release uses, inside the pinned lab checkout. All 26 tests
pass: every path once valid, and each rule once violated. Output mutations happen before
signing, so the signature stays valid and the test really exercises the script's output
binding rather than a broken signature.

Covered rejections: release or refund redirected to the signing party, short payout, an
extra output, a foreign signature, a claim one DAA score before the deadline, a claim or
release against a frozen escrow, freezing into a state that stays ACTIVE or into a foreign
script template, freezing twice, a settlement with one real signature, a settlement
against an unfrozen escrow, and forged witness parameters on every path.

Measured on the passing runs:

| Path    | Redeem script | Witness | Signature script |
| ------- | ------------- | ------- | ---------------- |
| release | 962 B         | 235 B   | 1200 B           |
| refund  | 962 B         | 237 B   | 1202 B           |
| claim   | 962 B         | 235 B   | 1200 B           |
| freeze  | 962 B         | 230 B   | 1195 B           |
| settle  | 962 B         | 296 B   | 1261 B           |

The script is well past the legacy 520-byte limit, which one test executes rather than
assumes. A freeze-then-settle dispute costs two transactions of this size, so a realistic
fee reserve has to cover both.

The compute budget is **not** measured by these tests. Running the whole suite with a
declared budget of 400, 200, 100, 50, 25, 5, 1 and even 0 passes every time, so
`TxScriptEngine::execute` does not enforce it here. What a 962-byte script with five
entries really needs, and whether a node relays it, has to come from consensus-level mass
validation or from a funded trial. The same caveat applies to fees and storage mass: the
engine happily accepts transactions this harness builds, which says nothing about
acceptance by the network.

## What V1 does not do

- **No deposits.** Freezing makes theft impossible, but a stubborn party can hold out
  for a split. With deposits (V2) that stalling would cost them too.
- **No arbiter, and no oracle.** The chain cannot see a parcel. KaspaLinks holds no key
  and never signs anything.
- **No partial release** outside a settlement.

## Open questions for the first funded trial

- Exact fee and storage-mass reserve per path, including the two-transaction
  freeze-then-settle route, and the compute budget a node actually requires.
- Whether `tx.daa` thresholds behave the same on chain as in the engine (the engine
  accepts the claim exactly at the threshold and rejects it one score earlier).
- Which wallets can sign a covenant spend for these paths; KasWare support decides
  whether the first trial runs on Testnet-10 or on mainnet with small amounts.
- Whether the seller should be able to refund while frozen (currently yes, as an
  escape hatch).
- Whether a late freeze needs a counter-measure beyond "claim promptly".

The first private canary now fixes 0.21 KAS as the active-state output, reserves 0.01 KAS
as its fee, uses compute budget 50, and commits `releaseAfter` at current DAA + 36,000.
Kaspium only creates the ordinary funding transaction. Release, refund and claim are
signed by the role-separated browser passkey and reconstructed exactly before the relay.
These are trial values rather than measured escrow limits; no funded Escrow V1 spend has
yet reached mainnet.

## Test matrix (engine level, no funds)

Each path passes under the intended conditions and fails otherwise:

1. `release` with the buyer signature, output bound to the seller: passes.
   Wrong recipient, wrong amount, two outputs, seller signature: fail.
2. `refund` from ACTIVE and from FROZEN with the right amounts: passes.
   Buyer signature, wrong recipient, FROZEN amount used in ACTIVE: fail.
3. `claim` at and after `releaseAfter`: passes. One DAA score earlier: fails.
   In FROZEN: fails.
4. `freeze` with the correct FROZEN output: passes, before and after the deadline
   (documented consequence). Wrong state, wrong amount, extra outputs, a foreign
   covenant template or a different state hash: fail.
5. `settle` with both signatures in FROZEN: passes. Either signature alone, or both in
   ACTIVE: fail.
6. Forged parameters that do not hash to the funded state: fail on every path.
