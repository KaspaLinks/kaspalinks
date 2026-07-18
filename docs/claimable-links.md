# Claimable Links

Claimable links let a creator lock a fixed amount of KAS into a one-time on-chain address and share
a link. The first person with the claim link can send the KAS to their own Kaspa address. If nobody
claims before the timer ends, the creator can use a private refund link to recover the unclaimed KAS.

## User Flow

1. The creator chooses a title, amount, network fee, and claim window.
2. The browser creates separate claim and refund key pairs.
3. Kaspa Links derives a one-time funding address from the public keys.
4. The creator funds that exact address with the exact amount shown in the UI.
5. The app waits until the funding transaction is detected on-chain.
6. The creator shares the claim link only after funding is detected.
7. The recipient opens the claim link, enters their own Kaspa address, reviews the transaction, and claims the KAS.
8. If the timer expires before a claim, the creator can open the private refund link and refund the unclaimed KAS.

### Expiry semantics

Kaspa Links stops preparing and relaying new claims when the configured DAA deadline is reached.
At that point the refund branch becomes valid and the creator can recover an unspent output. The
current two-branch contract does not impose a hard on-chain upper time bound on the claim signature
itself. A valid claim transaction built outside Kaspa Links could therefore compete with the refund
until one transaction is accepted. The funding output is closed only once the refund or claim is
confirmed on-chain.

## Safety Model

- Kaspa Links never stores claim or refund private keys.
- The claim code and refund code live in the browser URL fragment after `#`.
- The X-safe share action uses the compact public claim URL. The private claim material remains in
  the browser-side URL fragment and is never submitted to the Kaspa Links server or placed in the
  visible post text.
- Creator recovery records are AES-GCM encrypted in local browser storage with key material derived
  from the session-only creator token.
- Browsers do not send URL fragments to the server.
- The server stores public metadata, funding status, and public keys only.
- On registration and before broadcast, the server reconstructs the canonical funding address and
  redeem script from those public keys and the refund lock time. Client-supplied or corrupted script
  metadata is rejected.
- Claim and refund transactions are signed in the browser.
- The server can relay already signed transaction JSON, but it cannot create a valid claim or refund by itself.
- The refund link is private. Anyone who gets it can refund after the claim window expires.

## Practical Rules

- Fund exactly the amount shown.
- Wait for the UI to say funding was detected before sharing the claim link.
- Save the private refund link immediately.
- New claimable links start at 1 KAS.
- Use small amounts while testing a new wallet or browser.
- Treat the claim link like cash: whoever has it first can claim it.
- For X posts, use **Post safely on X** instead of pasting the private claim URL directly.
- A creator profile cannot be deleted while an open claimable link may still hold KAS. Close the
  link first, or remove an unfunded draft after the app verifies that its address received nothing.
- Removing a closed claimable link hides it from My Links but retains its non-secret historical
  amount and status so public all-time payment totals do not decrease.

## Incorrect Funding Amounts

Every wallet payment creates a separate on-chain UTXO. Kaspa Links never combines two payments and
never treats a later payment as the missing difference. If the one-time funding address receives an
amount other than the exact amount shown, the UI identifies that unspent output and keeps the claim
link locked.

For a single link that has not been shared or funded correctly, the creator may explicitly adopt one
verified unspent payment as the new link amount. The server updates public metadata only; claim and
refund codes remain in the browser. Batch amounts cannot be changed because the allocator contract
already commits to the exact child outputs.

After the claim window expires, each additional unspent output can be recovered separately with the
private refund link or batch recovery bundle. The browser signs the recovery refund, the server sees
only signed transaction JSON, and the original link or batch status is not changed. Outputs that are
too small to leave the reliable minimum after the configured fee cannot be recovered through this
flow.

## Technical Notes

The current implementation uses a browser-built claim/refund spend path and a server-side relay for
signed transaction JSON. The UI asks the server to derive the claimable funding script from public
keys, then the browser signs the claim or refund spend with the private code held in the URL
fragment.

The stored database record is intentionally not enough to move funds. It tracks public link
metadata, amount, fee, funding address, refund lock time, and on-chain status. It does not contain
the claim code, refund code, private keys, seed phrases, or wallet credentials.

For normal payment links, the wallet sends directly to the creator's recipient address. For
claimable links, the creator first funds a one-time script address, and the recipient later spends
that output to their own address through the claim flow.

## One-Time Batches

The protected batch flow creates between two and ten independent claimable links from one funding
payment. The browser generates one activation key, one unactivated-batch refund key, and separate
claim/refund keys for every child link. Kaspa Links stores only the public manifest that commits the
exact ordered child amounts and script public keys.

Before funding, the creator must download the private recovery bundle. The wallet then sends the
exact batch total to one allocator address. After funding is detected, the browser signs an
activation transaction which can create only the committed child outputs. The server verifies the
public manifest and signed transaction before relaying it.

- Before activation, an expired batch can be refunded as one output.
- Activation is refused when the shared claim window has expired.
- After activation, every child is independent and unclaimed children must be refunded separately.
- Refunds are explicit browser-signed transactions, never automatic server actions.
- A recipient address may claim more than one child if it receives more than one bearer link.
- The recovery bundle contains private bearer material. Keep it offline and never share it.
