# Release Verification

Run these checks before deploying or announcing a release.

## Automated Checks

- Requested behavior is implemented and documented.
- `pnpm lint` succeeds.
- `pnpm typecheck` succeeds.
- `pnpm test` succeeds.
- `pnpm build` succeeds.
- The non-custodial and security rules in `docs/security.md` remain intact.

## Payment Flow

Verify on mobile and desktop:

1. Open a public payment link and review title, amount, recipient, and message.
2. Copy the address, amount, and payment URI.
3. Confirm the QR encodes the expected URI.
4. Open the wallet handoff and verify the wallet receives the expected address and amount.
5. Create a PaymentRequest and confirm it starts as `PENDING`.
6. Complete a real wallet payment on the intended network.
7. Confirm the UI reaches `CONFIRMED` and shows the transaction explorer link.
8. Confirm expired requests cannot be confirmed.

## Claimable Flow

1. Create a claimable link with a small controlled mainnet amount.
2. Fund the exact one-time address and confirm funding detection.
3. Open the public claim URL in another browser and verify the private fragment loads locally.
4. Claim to a controlled address and verify the on-chain output and final UI state.
5. Create another link, allow it to expire, and verify refund behavior.
6. Confirm claimed, expired/refundable, refunded, and unknown-spend states remain distinguishable.
7. Confirm no claim or refund key appears in server logs, database rows, or API requests.

## Deployment Security

- Production uses unique values for every secret in `.env`.
- `.env`, SSH keys, wallet material, and operator credentials are absent from source control.
- `MOCK_CONFIRM_ENABLED=false` in production.
- Caddy is the only public ingress.
- The app, PostgreSQL, and claimable relay have no public host ports.
- `/operator-stats` remains behind its dedicated operator gate.
- Audit metadata contains no tokens, authorization headers, private keys, or wallet secrets.
- The deployed `/api/health` commit matches the intended Git commit.

## Repository Hygiene

- Review `git diff` before release.
- Run the repository secret scan.
- Confirm public documentation contains placeholders only.
- Confirm generated build output, local databases, logs, backups, and environment files are not
  tracked.
