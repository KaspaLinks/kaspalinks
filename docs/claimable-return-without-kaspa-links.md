# Getting unclaimed KAS back without Kaspa Links

Claim links with automatic return send unclaimed KAS back to your wallet by themselves: after the
claim window, Kaspa Links' worker (or anyone pressing **Return now**) broadcasts the return. This
guide is for the case where Kaspa Links is not there to do that, for example because the service
is down for a long time.

It works because the return needs no key. The on-chain script lets anyone spend the expired
output, but only into one payment to the wallet address you entered when you created the link,
minus the fee that was fixed then. Nobody, including Kaspa Links, can send it anywhere else.

This applies to claim links that asked for **your wallet address** when you created them. Older
links with a private refund link work differently; see
[claimable-links.md](./claimable-links.md#older-links-refund-link-and-recovery-bundle).

## 1. Keep the return file (optional, while Kaspa Links is up)

After your payment is detected, open the link page, expand **More** and choose **Download return
file**. The file `kaspa-links-return-<link>.json` contains:

- the prepared return transaction,
- the public values it is built from: funding address and output, contract script, your return
  address, amount, fee and the end of the claim window.

It holds no secret. Someone who gets the file can at most send your KAS back to your own wallet
after the claim window, which is exactly what you want. Keep it with your other wallet notes.

## 2. Send it after the claim window

You need [Node.js](https://nodejs.org) 22 or newer and a copy of this repository:

```sh
git clone https://github.com/KaspaLinks/kaspalinks.git
cd kaspalinks
node tools/claimable-return/send-return.mjs ~/Downloads/kaspa-links-return-<link>.json
```

No `npm install` is needed: the script uses the official Kaspa WASM SDK that ships in
`vendor/kaspa-wasm-v2.0.1`.

The first run only checks. It verifies that the transaction in the file really spends the stated
funding output, pays exactly the stated amount to the stated return address and is locked until
the end of the claim window. Then it connects to public Kaspa nodes and tells you one of:

- **The claim window is still open**, with the remaining time.
- **Nothing to return**, because the link was claimed or already returned.
- **Ready**, which means the output is still locked and the return can be sent.

**Check that the printed address is your own wallet**, then send:

```sh
node tools/claimable-return/send-return.mjs ~/Downloads/kaspa-links-return-<link>.json --send
```

The script prints the transaction id and a kaspa.stream link. To use your own node instead of the
public resolver, add `--node wss://<your-node>:<port>`.

## 3. If you do not have the return file

The file is built from four public values: the claim public key, your return address, the exact
end of the claim window (a DAA score) and the return fee. Together they determine the contract
script and the funding address. Kaspa Links stores them, but the chain does not show them until the
output is spent, and the claim link alone does not contain the window end or the fee. Without
Kaspa Links and without the file, rebuilding the return is therefore impractical. That is why the
return file exists.

## What can still happen

- Until a return is confirmed, the recipient can still claim the link. Whichever transaction
  confirms first wins; the KAS goes either to the recipient or back to you.
- A payment to the link address that leaves less than the 0.2 KAS network minimum after the return
  fee cannot be returned.
- The file covers the payment that funded the link. Extra payments to the same address each need
  their own return; Kaspa Links sends those automatically when it is running.
