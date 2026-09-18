# Escrow links — status and next steps

One page that says where the escrow work stands, what is proven, what is decided, and
what the next step is. Details live in [escrow-links.md](./escrow-links.md) (interface)
and [escrow-covenant-v1.md](./escrow-covenant-v1.md) (contract).

## Where it stands

| Piece                                                          | State                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Interface prototype (`/escrow`, `/escrow/new`, `/escrow/[id]`) | Live, mock data only, visible to allowlisted creators (`ESCROW_LINKS_PROTOTYPE_CREATORS`). Nothing is stored, no KAS move. |
| Covenant V1 (`labs/claimable-script/escrow_v1.sil`)            | Compiles to a 962-byte script; 26 engine tests pass against the real script engine. No funded transaction.                 |
| Transaction building, wallet signing, persistence              | Not started.                                                                                                               |

## Decided

- Escrow links, not a marketplace: the deal is agreed elsewhere, KaspaLinks only carries
  the payment. No listings, no search, no messages, no ratings.
- No fee, private sellers, no arbiter. KaspaLinks holds no key and never decides who is
  paid.
- V1 has no deposits: the buyer funds one covenant output.

## Open decisions

1. **Deposits in V2 or not.** They make stalling expensive, but the buyer has to lock
   roughly twice the price and funding needs both parties.
2. **First funded trial on Testnet-10 or on mainnet with small amounts.** Depends on
   what the wallet can sign; the giveaway covenant trials went to mainnet with ~0.22 KAS.
3. **Whether the escrow code goes public on GitHub.** The commits are local only.
4. **When to get legal advice**, before anything is opened beyond a single test account.

## Next steps

Each step is done when its check passes. Nothing below moves real money except step 6.

**3. Script builder in TypeScript** (`packages/kaspa`)

Build the redeem script and funding address from the deal parameters, derive both state
hashes, and encode the witness for each of the five paths. Export fixtures the way the
giveaway covenant does, so the Rust engine tests can run against data produced by the
TypeScript side.

_Check:_ TypeScript and Rust agree byte for byte on script, template hash and every
witness; unit tests in the repo; the engine accepts the TypeScript-built spends.

**4. Transaction building and browser signing**

Build funding and spending transactions with the vendored Kaspa SDK, sign them in the
browser through KasWare, and detect the funding through the indexer. No key ever reaches
the server.

_Check:_ every path produces a signed transaction in the browser on testnet or as a
dry run; the wallet handles a covenant spend at all, which is still unverified.

**5. Minimal persistence**

One database record per escrow link (parameters, state, transaction ids), an API with
Zod validation and rate limits, so the buyer can open the same link and both sides see
the same state. Still restricted to allowlisted creators.

_Check:_ a link survives a reload and two different browsers see the same state.

**6. Funded trial**

Small amounts between two own wallets. Walk three escrows: release, freeze followed by a
settlement, and a claim after the deadline.

_Check:_ three escrows completed on chain with their transaction ids recorded, plus the
numbers the engine cannot give us: fees, storage mass, compute budget and whether nodes
relay a transaction of this size.

**7. Wire the interface to real data**

Replace the fixtures with the persisted escrows, keep the prototype notice until step 6
has passed, and correct any copy that promises something the covenant does not enforce.

**8. Before anyone else uses it**

Legal review (the questions are in the earlier notes: platform duties, DAC7, imprint and
privacy), a copy pass, and a decision on who may create escrow links.

## Constraints to carry forward

- **A time lock only proves "not before".** Freezing cannot be capped in time, so after
  the deadline claiming and freezing race each other. The seller should claim promptly.
- **Without deposits, stalling is free.** Nobody can steal, but a stubborn party can hold
  out for a split.
- **The engine proves rules, not acceptance.** Fees, mass, compute budget and relay
  behaviour are unproven until step 6.
- **KaspaLinks must stay non-custodial.** No arbiter key, no server-side signing, no
  wording that promises custody or buyer protection.
