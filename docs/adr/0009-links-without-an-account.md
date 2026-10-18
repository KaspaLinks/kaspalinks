# Links work without an account

Payment links (tip, donation, goal, invoice, fixed amount) and single claimable links can be
created without a KaspaLinks account. The browser generates a private manage token and sends only
its SHA-256; the token lives in the private manage link (URL fragment) and in that browser's list
of links. Whoever holds it can see payments, pause or delete a payment link, or move the link into
an account later, which clears the token. The money never touches us either way: payments go
straight to the recipient address, claim links return by themselves (ADR 0007). Statistics keep
`createdWithoutAccount` after a move, so account-free creation stays measurable. Account-free
payment pages warn payers that nobody known to us is behind the link, creation asks for Turnstile
when it is configured, and per-IP limits apply in memory only. Accounts remain required for
profiles, Telegram, notifications and escrow links.
