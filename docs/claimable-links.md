# Claimable Links

A claimable link locks a fixed amount of KAS in a one-time on-chain script and lets you share it
like a gift card: the first person who opens the full private link can claim the KAS to their own
wallet. If nobody claims it in time, the KAS goes back to your wallet by itself.

## Which section applies to my link?

| Your link                                                                                         | How unclaimed KAS comes back                            | Read                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Created from 18 October 2026 on: the create page asked for **your wallet address**                | Automatically, to that address. Nothing to save.        | [Current links](#current-links-automatic-return)            |
| Claim Drop created after automatic returns were switched on: it asked for **your wallet address** | Automatically, per link. Nothing to save.               | [Claim Drops](#claim-drops)                                 |
| Created earlier: you saved a **private refund link** or a **recovery bundle**                     | You refund it yourself with that refund link or bundle. | [Older links](#older-links-refund-link-and-recovery-bundle) |

Older links keep working exactly as before. Nothing about them changed when automatic returns
arrived.

## Current links: automatic return

### Flow

1. Choose an amount (from 1 KAS), a claim window and **your own wallet address** for the return.
   Use a wallet you control, not an exchange deposit address.
2. Your browser creates the claim code. Kaspa Links derives a one-time funding address from the
   public claim key, your return address, the end of the claim window and the return fee.
3. Pay that exact amount to the funding address from your wallet.
4. Once the payment is detected, share the claim link privately.
5. The recipient opens the link, enters their own Kaspa address and claims the KAS. Their browser
   signs the claim; the KAS goes straight from the script to their wallet.
6. If nobody claims before the window ends, the KAS returns to your wallet automatically.

No account is needed for a single link, and there is no refund link or recovery file to keep.

### What if…

- **…the link gets into the wrong hands?** A claim link works like cash: whoever opens the full
  private link first can claim it. Share it only with the person it is for. The part after `#`
  holds the claim code; browsers never send it to our server, and the public preview text never
  contains it.
- **…nobody claims it?** After the claim window the script allows exactly one thing besides a
  claim: sending the KAS to the return address committed when the link was created, minus the
  return fee that was also committed then. Our worker broadcasts this return, usually within a
  minute or two of expiry. Anyone, including you, can trigger the same transaction with
  **Return now** on the link page. Nobody can choose a different destination, not even Kaspa
  Links.
- **…the return is late?** Until a claim or the return is confirmed on-chain, the KAS stays in
  the script. The claim path has no hard on-chain end, so a claim built outside Kaspa Links could
  still compete with the return after expiry; whichever confirms first wins. The KAS can only ever
  reach the claimant or your return address.
- **…Kaspa Links is offline?** The KAS stays locked in the script; it cannot be moved anywhere
  else in the meantime. The return goes out once a worker or a visitor broadcasts it again.
  Everything needed to rebuild that return transaction is public (claim public key, return
  address, end of the claim window, return fee), so the open-source code can build it without our
  servers. A step-by-step guide for doing that by hand is planned.
- **…I paid a different amount?** Every payment is a separate on-chain output, and Kaspa Links
  never combines two payments. A wrong amount keeps the link locked. If you created the link with a
  profile, you may adopt one verified payment as the new link amount before sharing. Every other
  output at the funding address goes back to your return address after the claim window, one
  transaction each.

### Safety model

- Kaspa Links stores public metadata only: amount, fee, funding address, public claim key, return
  address, end of the claim window and on-chain status. It never stores the claim code, private
  keys, seed phrases or wallet credentials.
- On registration and again before any broadcast, the server rebuilds the canonical script and
  funding address from those public values and rejects anything that does not match exactly.
- Claims are signed in the recipient's browser. The return needs no key at all; the script itself
  fixes its destination and fee.
- The server relays already signed or keyless transactions. It cannot create a claim, and it
  cannot redirect a return.

## Claim Drops

A Claim Drop creates 2 to 8 separate claim links from one payment. It needs a free creator profile
(a username is enough).

1. Choose the number of links, the amount per link, a claim window and your wallet address.
2. Your browser creates one activation key and a claim code per link. Kaspa Links stores only the
   public manifest: the exact ordered child amounts and scripts.
3. Pay the exact total to the Claim Drop address.
4. After the payment is detected, your browser signs the activation. It can only create the
   committed child outputs; each child is a link with automatic return.
5. Share each link with one person.

If the drop is never activated (for example because the browser that created it is gone), the
whole payment returns to your wallet automatically after the claim window. After activation, every
unclaimed link returns on its own. There is no recovery file.

A recipient who receives more than one link can claim more than one; each link is a separate
bearer link.

## General rules

- Fund exactly the amount shown, and wait until the payment is detected before sharing.
- Use small amounts while you try a new wallet or browser.
- A creator profile cannot be deleted while one of its open links may still hold KAS.
- Removing a closed link hides it from My Links but keeps its non-secret amount and status, so
  public all-time totals do not decrease.

## Older links: refund link and recovery bundle

Links created before automatic returns (script version 1) use a different contract: instead of a
return address they commit a **refund key** that only the creator holds.

- When the link was created, the browser generated separate claim and refund keys, and you
  downloaded a private recovery bundle (or saved the private refund link) before funding.
- After the claim window, open the private refund link or import the recovery bundle, and your
  browser signs the refund to an address you choose.
- Refunds of these links are never automatic. Kaspa Links does not have the refund key and cannot
  refund for you. If the refund link and the recovery bundle are both lost, an unclaimed output
  cannot be recovered by the creator.
- Older Claim Drops work the same way: one recovery bundle covers the drop. Before activation the
  drop refunds as one output; after activation every unclaimed link is refunded separately.
- Extra payments to an older link's address are refunded separately with the same refund link or
  bundle after the claim window.
- Keep the refund link and the recovery bundle private and offline: anyone who has them can refund
  after the claim window.

## Technical notes

Normal payment links send directly from the supporter's wallet to the creator's address. A
claimable link first funds a one-time script address; the recipient later spends that output to
their own address.

The current claim script has two branches: a claim signed with the link key, and after the claim
window a keyless return of the single input into one output to the committed return script, worth
at least the input minus the committed fee. See
[ADR 0007](./adr/0007-claimable-links-return-automatically.md) for the decision and
[claimable-links-lab.md](./claimable-links-lab.md) for the design history of both versions.
