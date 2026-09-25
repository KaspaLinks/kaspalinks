# Mediated Escrow V2 — laboratory design

Status: the SilverScript contract, canonical transaction builder, three-role
passkey signing, creator flow at `/escrow/new`, public mobile flow and isolated
V2 database/API are implemented locally. The pinned covenant engine passes
every normal path and the negative tests listed below. Existing
`/escrows/:publicId` links remain Escrow V1. V2 may be deployed only as the
allowlisted 0.22 KAS Mainnet canary until the remaining spend paths and fee/mass
measurements pass; it must not yet be offered for ordinary purchase amounts.

## Agreement before funding

The current canary fixes funding at 0.22 KAS and the normal payment at 0.21 KAS.
The seller supplies a payout address, identifies an independent mediator and
chooses the buyer inspection delay. The buyer supplies a refund address and
passkey, then reviews the complete immutable terms before funding.
The mediator must be identified independently of Kaspa Links. The mediator key
cannot equal either party key. Kaspa Links holds no signing key and cannot
redirect, freeze, settle or receive escrow funds.

The seller chooses a 7, 14 or 30 day inspection delay. It begins only after the
ACTIVE funding output confirms. The frozen fallback is thirty days after the
FROZEN output confirms. These are DAA-score delays; the UI shows calendar times
as estimates, not guaranteed wall-clock deadlines. Claim does not become
available just because a buyer accepted a link.

## Paths

| State                            | Action                       | Required signature(s)                     | Outcome                                                                          |
| -------------------------------- | ---------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| ACTIVE                           | Release                      | Buyer                                     | Seller receives the committed amount.                                            |
| ACTIVE                           | Refund                       | Seller                                    | Buyer receives the committed amount.                                             |
| ACTIVE                           | Claim after inspection delay | Seller                                    | Seller receives the committed amount.                                            |
| ACTIVE                           | Freeze                       | Buyer                                     | The committed amount moves into FROZEN, spending one reserved fee.               |
| ACTIVE with wrong funding amount | Recover invalid deposit      | Buyer, plus a separately signed fee input | The entire invalid deposit returns to the buyer. It cannot mark the deal funded. |
| FROZEN                           | Refund                       | Seller                                    | Buyer receives the remaining amount after the exit fee.                          |
| FROZEN                           | Agree on split               | Buyer + seller                            | Only the committed buyer/seller payout addresses can receive the split.          |
| FROZEN                           | Mediated split               | Mediator + buyer **or** mediator + seller | Only the committed buyer/seller payout addresses can receive the split.          |
| FROZEN                           | Fallback after thirty days   | Seller                                    | Seller receives the remaining amount after the exit fee.                         |

The mediator cannot sign alone. Buyer and seller can agree without the mediator.
A mediator can collude with one party; users need to select a genuinely
independent mediator before funding and see this trust assumption in the UI.
An absent mediator does not lock the funds forever, but the pre-agreed seller
fallback means the buyer's dispute protection is limited to the thirty-day
window. Freeze remains possible after the ACTIVE claim threshold until the
seller's claim is mined; those transactions race for the same UTXO. A late
freeze can therefore delay the seller by up to another thirty days.

## Monetary accounting

As in V1, funding is `amount + fee`. A normal ACTIVE exit pays `amount` and
uses `fee` for the transaction. Freeze pays `amount` into FROZEN and uses the
first `fee`. A frozen exit pays `amount - fee` and uses a second `fee` out of
the held amount. This must be disclosed before funding, and the amount must be
larger than the fee. The first Mainnet canaries must measure actual consensus
mass, compute budget, minimum spendable outputs and relay acceptance; the lab
fee is not a production recommendation.

All normal paths enforce one input with exactly the committed funding value.
If a wallet sends a different value to the ACTIVE address, the buyer can use
the separate recovery entry, with a second input to pay the network fee, to
return the full incorrect deposit to the committed buyer address. This rescue
path has passed the covenant engine test. The browser builder for its separate
fee input and wallet signature still needs implementation before a wrong-value
Mainnet recovery can be offered in the UI.

## Integration gates

1. **Passed:** pinned engine verification for active/frozen paths, early locks,
   foreign mediator, wrong party, changed recipient, changed split, exact input
   value and invalid-funding recovery.
2. **Passed locally:** canonical builders and browser signing for all ordinary
   paths. The server accepts signed SafeJSON only, rebuilds every output and
   requires SIGHASH_ALL. Two-party partial signatures cannot replace an earlier
   signer and expire after thirty minutes.
3. **Implemented locally:** separate V2 records, URLs and API routes. The normal
   creator path now creates persistent V2 links instead of the earlier fixture.
   The public view distinguishes onboarding, funding, active, freeze submitted,
   frozen and terminal states from indexed UTXOs and submitted transaction IDs.
4. **Still required:** complete a small-value Mainnet canary for freeze, bilateral settlement,
   mediated buyer award, mediated seller award and fallback before allowing
   ordinary purchase amounts. Test browser restart and two-device signing for
   each role.
5. **Still required:** implement and test the browser transaction with an extra
   fee input for wrong-value recovery, measure mass/compute budget and run the
   relay acceptance matrix. Shipping evidence and dispute communication remain
   off-chain; a Kaspa covenant cannot determine whether a physical item arrived
   or matched its description.

## Private Mainnet canary deployment — 25 September 2026

The normal `/escrow/new` path now opens the persistent mediated V2 creator instead of the
earlier fixture creator. Existing V1 records and `/escrows/:publicId` URLs remain
unchanged.

Migration `20260924173000_add_mediated_escrow_v2` passed first against an empty PostgreSQL
16 container and then against production. The new table contained zero rows after
deployment. Internal and origin health checks returned the exact release SHA, the app
stayed healthy with zero restarts, an unauthenticated creator API request returned 401 and
an unknown public mediated escrow returned 404.

No escrow record or passkey was created, no KAS was sent and no transaction was signed or
broadcast during the deployment. The browser confirmed the new build; the signed-in
creator screen and real three-device canary remain the next operational checks.
