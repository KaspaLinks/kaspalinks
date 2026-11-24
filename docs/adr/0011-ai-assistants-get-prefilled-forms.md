# AI assistants get prefilled forms, not links

KaspaLinks offers AI assistants (any Model Context Protocol client) a public, stateless MCP
server at `/api/mcp` whose tools only read. `prepare_payment_link`, `prepare_claim_link` and
`prepare_giveaway` return a kaspalinks.com form with the user's values filled in. Values travel
after the `#`, so the recipient address stays out of access logs. `list_open_giveaways` shows only
the numbers the covenant commits to, never a creator's title, so no creator text reaches the
assistant. The user opens the form, checks that the address is their own and creates the link
there. ADR 0003 already keeps AI away from mutations; this applies the same rule to outside
assistants.

## Considered options

- Creating account-free links directly from the tool would skip the human check (Turnstile), put
  the private manage link into the assistant's transcript, and make per-IP limits useless, because
  assistants call from shared addresses.
- OAuth sign-in for creator accounts would allow real creation but adds an authorization server
  and token handling for a channel that has no measured demand yet.

## Consequences

Prefilled forms show a note asking the user to confirm the address is theirs, because a shared
prefilled link could carry someone else's address. Tool usage is measured through `from=mcp`
visits and `[mcp] tools/call` log lines; nothing about the user is stored.
