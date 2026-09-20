# Escrow links — status and next steps

One page that says where the escrow work stands, what is proven, what is decided, and
what the next step is. Details live in [escrow-links.md](./escrow-links.md) (interface)
and [escrow-covenant-v1.md](./escrow-covenant-v1.md) (contract).

## Where it stands

| Piece                                                          | State                                                                                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface prototype (`/escrow`, `/escrow/new`, `/escrow/[id]`) | Live, mock data only, visible to allowlisted creators (`ESCROW_LINKS_PROTOTYPE_CREATORS`). Nothing is stored, no KAS move.                                     |
| Covenant V1 (`labs/claimable-script/escrow_v1.sil`)            | Compiles to a 962-byte script; 26 engine tests pass against the real script engine. No funded transaction.                                                     |
| TypeScript script/address/witness builder                      | Implemented locally; six vectors match the Rust compiler ABI and execute in the engine.                                                                        |
| Transaction building, wallet signing, persistence              | Not started.                                                                                                                                                   |
| Passkey signer capability lab (`/toccata-lab/passkey-signer`)  | Implemented locally; device verification pending. It derives a public secp256k1 identity locally and never signs or broadcasts.                                |
| Passkey Escrow-V1 dry run                                      | Implemented locally. Builds a fake-outpoint 1 KAS release, signs it with Kaspa WASM after passkey verification, checks immutable intent, and cannot broadcast. |

## Decided

- Escrow links, not a marketplace: the deal is agreed elsewhere, KaspaLinks only carries
  the payment. No listings, no search, no messages, no ratings.
- No fee, private sellers, no arbiter. KaspaLinks holds no key and never decides who is
  paid.
- V1 has no deposits: the buyer funds one covenant output.
- Funding wallets and escrow signers are separate: a normal wallet may fund the
  output, while a PRF-capable passkey is being evaluated for local covenant signing.
- Shipping is off-chain metadata on an `active` escrow. `claimed`, `refunded`, and
  `cancelled_unfunded` are distinct terminal outcomes; there is no automatic release.

## Passkey signer acceptance gate

The private lab is available only through the existing escrow creator allowlist. It
creates or selects a discoverable passkey, requests user verification, obtains the
WebAuthn PRF result, applies domain-separated HKDF, and derives the x-only secp256k1
public key. PRF output and secret scalar stay in browser memory and are wiped on the
best-effort basis available to JavaScript.

No real escrow may rely on this path until the same fingerprint is reproduced after
page reload, browser restart, device restart, on a second synced Apple/Google device,
and after links opened from embedded mobile browsers are handed to Safari or Chrome.
Any mismatch or missing PRF result blocks that environment from funded use.

The same private lab also contains an offline release dry run. It uses the
passkey-derived buyer key, the compiled Escrow-V1 SilverScript artifact and the
vendored Kaspa WASM signer to construct a full `SIGHASH_ALL` witness. Its outpoint
is deliberately synthetic and the function exposes no relay or network call.

## Open decisions

1. **Deposits in V2 or not.** They make stalling expensive, but the buyer has to lock
   roughly twice the price and funding needs both parties.
2. **First funded trial on Testnet-10 or on mainnet with small amounts.** Depends on
   what the wallet can sign; the giveaway covenant trials went to mainnet with ~0.22 KAS.
3. **Whether the escrow code goes public on GitHub.** The commits are local only.
4. **When to get legal advice**, before anything is opened beyond a single test account.

The local UI now follows V1 without deposits, allows late freeze, and exposes seller refund while frozen. This UI was deployed on 19 September as release `111123bd`, restricted to creator `example`.

## Next steps

Each step is done when its check passes. Nothing below moves real money except step 6.

**3. Script builder in TypeScript — implemented and verified offline, 19 September** (`packages/kaspa`)

Build the redeem script and funding address from the deal parameters, derive both state
hashes, and encode the witness for each of the five paths. Export fixtures the way the
giveaway covenant does, so the Rust engine tests can run against data produced by the
TypeScript side.

_Check:_ TypeScript and Rust agree byte for byte on script, template hash and every
witness; unit tests in the repo; the engine accepts the TypeScript-built spends.

**4. Transaction building and browser signing — offline spend builder implemented; wallet integration pending**

The offline spending builder now covers release, both refund states, claim, freeze and
joint settlement. The wallet transport rejects changed transaction intent, requires
SIGHASH_ALL and preserves the other party's signature and covenant witness. Tests use
SDK-generated signatures with deterministic lab keys, not an installed KasWare wallet.
The full P2SH wrapper is cross-checked against the covenant-enabled Rust engine.
The vendored SDK's legacy P2SH encoder rejects this 962-byte script, so the lab builder
uses canonical OP_PUSHDATA2, verified byte for byte by Rust. This is not evidence of
current mainnet activation or wallet/relay acceptance.

Still required: verify signatures cryptographically against the committed signer and
finalize reconstructed transactions before relay; validate selected wallet account and
network; determine fees and compute budget; connect the browser UI and indexer.
There is no production signing or broadcast path wired to this helper.

Build funding transactions with the vendored Kaspa SDK, sign them in the
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

## Offline verification, 19 September 2026

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`: passed.
- Vitest: 984 tests across 150 files; 12 tests cover the new transaction/signing transport.
- Covenant-enabled Rust engine: 27 tests passed, including the complete TypeScript
  P2SH script wrapper. SDK signatures themselves still need cross-engine verification.
- Changed modules: `packages/kaspa/src/escrow-v1-transaction.ts`,
  `packages/wallet-adapter/src/escrow-signing.ts`, associated tests and exported lab vectors.
- No application deployment, wallet interaction, funding or transaction broadcast.

## Private deployment, 19 September 2026

Release `111123bd265a3a26e0640a9fd7d7dbb3f6dbd536` deployed to Hetzner.
The app container is healthy with zero restarts. Runtime flags remain enabled with
`ESCROW_LINKS_PROTOTYPE_CREATORS=example`. No database migrations, wallet interactions
or escrow broadcasts occurred; the UI still uses fixtures.

The release snapshot is preserved on branch `codex/escrow-v1-private-release-20260919`.
Source, environment and database backups and the previous image are retained under
`/var/backups/kaspa-actions/releases/111123bd/`; `rollback.sh` restores the previous app.
All 601 baseline source files matched before staging. Docker production build passed.
Public health reports the exact release; missing and invalid creator credentials return 401. The browser shows the not-found view to an anonymous visitor on the new build.
The signed-in `example` view was not exercised because no authenticated session was
available in the verification tab. Local access helper and API tests passed (8 tests).
The initial Python HTTP probe received 403; curl and browser checks succeeded.
About 4 GB disk space remains; future image builds should account for this.

## Wallet priority: Kaspium first (19 September 2026)

User requested Kaspium before KasWare. Reviewed upstream Kaspium main at
`4646b96ba23da00f74eef5c423d1323cd6f25a99` (source inspection, not an installed-app test).
`lib/kaspa/types/kaspa_uri.dart` parses address/amount/label/message payment URIs;
`lib/wallet_home/wallet_home.dart` routes app links to the ordinary send flow.
`lib/sign_message/sign_message_sheet.dart` invokes `signPersonalMessage`, not a raw
transaction signer. No PSKT or WalletConnect integration was found in this checkout.

Consequently, a complete Kaspium-only V1 flow is blocked on an exposed covenant
transaction-signing facility. QR funding is a separate capability and must not be
presented as full escrow support or enabled before a verified spending path exists.
Do not substitute personal-message signatures for transaction signatures, import a
wallet seed into the browser, or silently introduce browser-held escrow keys.
A separate per-deal browser signer would require a product/architecture decision,
a recovery design and an explicit exception to the wallet-signing requirement.
KasWare remains the subsequent integration, per user priority. No code or deployment
change was made for Kaspium; this entry records the concrete integration blocker.

Sources:

- https://github.com/azbuky/kaspium_wallet/blob/4646b96ba23da00f74eef5c423d1323cd6f25a99/lib/wallet_home/wallet_home.dart
- https://github.com/azbuky/kaspium_wallet/blob/4646b96ba23da00f74eef5c423d1323cd6f25a99/lib/sign_message/sign_message_sheet.dart
