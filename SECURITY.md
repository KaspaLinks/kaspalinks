# Security Policy

Kaspa Links is non-custodial: it never holds user funds, private keys, seed phrases or claim codes.
Security issues are still taken seriously, especially anything that could move, lock or misdirect
KAS.

## Reporting a vulnerability

Please do not open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub instead: open the
[Security tab](https://github.com/KaspaLinks/kaspalinks/security) of this repository and choose
**Report a vulnerability**. Only the maintainers can see the report.

Helpful details:

- what is affected (kaspalinks.com, the source in this repository, or a contract in
  `labs/claimable-script`),
- steps to reproduce, or a transaction or link id on testnet or mainnet,
- what an attacker could achieve, for example claim someone else's KAS, redirect a return, block a
  giveaway draw or read private data.

Please do not test against other people's links, giveaways or funds, and do not run load or
denial-of-service tests against kaspalinks.com.

## What to expect

This is an independent community project without a security team. We read every report, reply as
soon as we can, and keep you updated while a fix is prepared. Issues that could cost users KAS come
first. With your permission we credit you once the fix is live.

## Scope notes

- Self-hosted deployments are run by their operators; report deployment-specific problems to them.
- [docs/security.md](docs/security.md) describes the security model, and
  [docs/claimable-links.md](docs/claimable-links.md) the remaining risks of claim links.
