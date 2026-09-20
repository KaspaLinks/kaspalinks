# Escrow links — status and next steps

One page that says where the escrow work stands, what is proven, what is decided, and
what the next step is. Details live in [escrow-links.md](./escrow-links.md) (interface)
and [escrow-covenant-v1.md](./escrow-covenant-v1.md) (contract).

## Where it stands

| Piece                                                          | State                                                                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface prototype (`/escrow`, `/escrow/new`, `/escrow/[id]`) | Live, mock data only, visible to allowlisted creators (`ESCROW_LINKS_PROTOTYPE_CREATORS`). Nothing is stored, no KAS move.                                  |
| Covenant V1 (`labs/claimable-script/escrow_v1.sil`)            | Compiles to a 962-byte script; 26 engine tests pass against the real script engine. No funded transaction.                                                  |
| TypeScript script/address/witness builder                      | Implemented locally; six vectors match the Rust compiler ABI and execute in the engine.                                                                     |
| Transaction building, passkey signing, persistence             | Private 0.22 KAS mainnet canary deployed with creator-owned persistence, exact UTXO detection and a signed-only relay boundary.                             |
| Passkey signer capability lab (`/toccata-lab/passkey-signer`)  | Private deployment. The same buyer identity was reproduced on iPhone and Mac and after browser restart; device-restart and embedded-browser checks remain.  |
| Passkey Escrow-V1 dry run                                      | All six V1 paths sign fake-outpoint transactions with Kaspa WASM, verify immutable intent, match the canonical builder byte for byte, and cannot broadcast. |
| Funded Escrow-V1 canary                                        | Release, immediate refund and deadline claim are privately deployed for creator `example`. No Escrow V1 output has been funded yet.                         |

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

The same private lab also contains isolated offline dry runs for release, freeze,
active and frozen refund, deadline claim, and joint settlement. Each required signer
uses a role-separated passkey context; the fixture supplies the unused counterparty.
The compiled Escrow-V1 SilverScript artifact and vendored Kaspa WASM signer construct
full `SIGHASH_ALL` witnesses. Joint settlement requires buyer and seller role
confirmation. Every outpoint is deliberately synthetic and the function exposes no
relay or network call.

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

**4. Transaction building and browser signing — implemented for the private canary**

The offline spending builder now covers release, both refund states, claim, freeze and
joint settlement. The wallet transport rejects changed transaction intent, requires
SIGHASH_ALL and preserves the other party's signature and covenant witness. Tests use
SDK-generated signatures with deterministic lab keys, not an installed KasWare wallet.
The full P2SH wrapper is cross-checked against the covenant-enabled Rust engine.
The vendored SDK's legacy P2SH encoder rejects this 962-byte script, so the lab builder
uses canonical OP_PUSHDATA2, verified byte for byte by Rust. This is not evidence of
current mainnet activation or wallet/relay acceptance.

The private canary separates ordinary-wallet funding from covenant signing. Kaspium sends
an exact payment URI to the committed P2SH address. WebAuthn PRF plus role-separated HKDF
derives the buyer or seller signing key in browser memory. Before relay, the server rebuilds
the whole transaction and accepts only the replacement of one empty signature slot. No key
or PRF result reaches the API.

_Check:_ every path now produces a signed browser dry run. Real node acceptance, fee
measurement, compute budget and a funded covenant spend remain unverified.

**5. Minimal persistence — implemented locally for the canary**

`EscrowPrototype` stores public terms, covenant addresses and submitted transaction IDs.
The creator-scoped API uses Zod validation, rate limits, exact output selection and an
atomic broadcast lease. Passkey material and ordinary wallet credentials are neither
accepted nor stored. The current canary is still a one-account self-test, not a shared
buyer/seller link.

_Check:_ the canary survives a reload; cross-browser state still needs the deployed test.

**6. Funded trial — next**

Start with three separate 0.22 KAS self-tests: release, immediate refund and claim after
the DAA deadline. Freeze followed by settlement remains a later canary because it needs a
second funded state transition and fee reserve.

_Check:_ three active-state exits completed on chain with their transaction ids recorded, plus the
numbers the engine cannot give us: fees, storage mass, compute budget and whether nodes
relay a transaction of this size.

## Mainnet canary implementation, 20 September 2026

The private signer page now has a third step. It creates two public signer commitments
from one passkey using different buyer/seller contexts, accepts one validated Kaspium
receive address for both self-test outcomes, and commits an absolute deadline about one
hour ahead. Funding is exactly 0.22 KAS: 0.21 KAS output plus a fixed 0.01 KAS fee.

The page restores the latest creator-owned canary after reload, shows a local QR/payment
URI, refreshes exact UTXO status, and offers release, refund or deadline claim. Preparing
does not sign or broadcast. A separate final-review card shows recipient, amount, fee and
outpoint; only the final button asks for the required passkey and submits the signed JSON.

Compute budget 50 follows the successful small giveaway canary. The escrow engine harness
cannot measure consensus compute units, so the first relay attempt remains the measurement.
A rejection does not spend the covenant output; the same passkey can sign a corrected
transaction after the budget or fee is adjusted. No funded transaction has been attempted.

## Private mainnet-canary deployment, 20 September 2026

Release `e7d9d63b096d3eabae4af8c976d7a21865fa30d1` is live on Hetzner. The exact
Git archive built successfully on the server. `pnpm lint`, `pnpm typecheck`, all 997
Vitest tests in 155 files and the production build passed locally before release.

Migration `20260920130000_add_escrow_prototype` first passed against a temporary empty
PostgreSQL 16 instance, then applied to production. Production contains zero canary rows
at deployment. The migration is additive and the pre-release custom-format database dump
was verified with `pg_restore --list`.

Only the app container was recreated. PostgreSQL, Caddy, the wRPC relay and Telegram
worker retained their container IDs. Internal and external health checks report the exact
release SHA; the app is healthy with zero restarts. The new API returns the shared 401
response without creator credentials, while an anonymous browser sees the normal 404 and
no lab content. The signed-in canary screen still needs the first creator walkthrough.

Backup, exact build source, logs, previous image and executable rollback script are under
`/var/backups/kaspa-actions/releases/e7d9d63b/`. Source-content drift is zero. Temporary
build layers were pruned without removing release or rollback images; 6.4 GB remained.
No KAS was sent, no passkey prompt was triggered and no transaction was broadcast during
deployment. The subsequent private acceptance run completed all three live Escrow V1 paths:
immediate refund (`a5f177d31c610e5ad5bd790f6aab3b142d0eb50c83476a9c91d4bc8011cfdf2c`),
buyer release (`bcd4c9380973ed621d8013fc6da4cc4a5c2744d4df1d6a0f7e3d0290637e777f`)
and seller claim after the committed deadline
(`7dfe06268f21fb9c503392bcee5e82ffda40744540b24a0e3dffa134614bed9c`).

## Shareable two-party beta, 20 September 2026

The next beta keeps the verified Escrow V1 transaction and relay boundary while separating the
two roles. An allowlisted creator commits a seller passkey and Kaspium payout address, receives a
private `/escrows/:publicId` link and shares it with one buyer. The first buyer atomically commits
their own passkey and refund address without a Kaspa Links account. Only then is the SilverScript
funding address generated.

The public mobile flow is Accept, Fund and Resolve. Funding remains exactly 0.22 KAS. Buyer release
pays 0.21 KAS to the seller; seller refund pays 0.21 KAS to the buyer immediately; seller claim pays
the seller only after the selected one, six or 24 hour DAA deadline. Each spend is rebuilt and
intent-checked by the server, signed in the relevant browser and accepted by the relay only as
canonical signed JSON. Passkey PRF output is never stored or transmitted. Shared pages are marked
`noindex` and public mutations are rate-limited.

The implementation adds an isolated `EscrowLinkPrototype` model rather than changing successful
canary records. The additive migration, lint, typecheck, 1,005 Vitest tests in 157 files and the
production build pass locally. Live deployment and a two-device walkthrough remain before real
funding.

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

## Offline verification, 20 September 2026

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`: passed.
- Vitest: 983 tests across 152 files. Seven browser dry-run tests cover every V1 path,
  both signer roles, exact canonical witness matching, amounts, deadlines and missing signers.
- Covenant-enabled Rust engine: 27 tests passed, including the complete TypeScript
  P2SH script wrapper. SDK signatures themselves still need cross-engine verification.
- Changed browser modules: `apps/web/src/app/toccata-lab/passkey-signer/escrow-dry-run.ts`,
  the compact path-card interface, styles and focused tests.
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
