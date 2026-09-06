# KaspaLinks Agent

KaspaLinks Agent is a channel-independent interface for creator-owned KaspaLinks operations.
Telegram is the only delivered channel in the current closed beta. Application Tools always derive
the Creator from server-authenticated `ActorContext`; Telegram text, callbacks, and AI output cannot
choose an owner.

## Non-custodial boundary

The Agent can create ordinary payment metadata, read creator-owned links and payment status, and
prepare browser handoffs. It never receives or stores wallet keys, seed phrases, claim codes,
refund codes, recovery bundles, or signed wallet credentials. It never signs or broadcasts a
Creator transaction.

`/giveaway` creates a ten-minute Giveaway Setup Draft containing only amount, title, entry window,
and winner-claim window. The Creator completes prize funding, recovery setup, and browser signing
on the existing Giveaway page. Claimable Links and Claim Drops do not enter the payment notification pipeline.
Public Giveaway result subscriptions use their own opt-in model and outbox kind; see
[Telegram giveaways](telegram-giveaways.md).

## Closed beta

Telegram access is controlled per Creator by `telegramBetaEnabled`; the default is `false`. An
ineligible Creator sees a waitlist and cannot generate a connection code. To enable only the
`example` Creator, leave every other record at its default and call:

```sh
curl -X PATCH "https://kaspalinks.example/api/admin/agent/creators/example" \
  -H "x-admin-token: <ADMIN_ACCESS_TOKEN>" \
  -H "content-type: application/json" \
  --data '{"telegramBetaEnabled":true,"aiEnabled":false}'
```

This is a database allowlist, not a hard-coded username check. It remains safe if the account is
renamed or beta access later expands.

## Telegram connection

1. The Creator sets a validated mainnet default recipient address and IANA timezone on `/agent`.
2. The Creator generates a random one-time code. A new code revokes the previous one.
3. Only the code hash is stored; it expires after ten minutes and is consumed once.
4. Telegram `/start <code>` or `/connect <code>` binds one private Telegram user and chat to one
   Creator.
5. Payment notifications remain off until the Creator explicitly enables them.

Telegram usernames are display metadata only and are never authentication identifiers. Group and
channel messages are ignored. Each `update_id` is durably deduplicated, and callback ownership is
checked against the connected Telegram user and private chat.

## Commands

```text
/links
/payments
/stats
/giveaways
/giveaway <KAS> <duration> <title>
/link <KAS> <title>
/invoice <KAS> <title>
/tip [KAS] <title>
/donation [KAS] <title>
/goal <KAS target> <title>
/disconnect
/stop — disable all public giveaway result reminders
```

Durations use `m`, `h`, or `d`, for example `/giveaway 10 24h Weekend KAS`. Explicit Slash
Commands execute deterministically. Giveaway commands stop at a browser handoff.

## Payment events and notifications

The private Agent Worker polls due Pending Payment Requests, applying an initial three-second
interval and bounded backoff. Confirmation, Invoice completion, AuditLog, unique Payment Event,
and optional Telegram Outbox row are committed in one PostgreSQL transaction. An Outbox dedupe key
allows one logical delivery per Payment Request; uncertain Telegram acknowledgements can still
produce repeated messages on retry. Telegram outages never roll back a
payment confirmation.

The first confirmed exact Invoice payment sets `invoicePaidAt`. The public Invoice remains visible
as paid, but new Payment Requests return `409 INVOICE_PAID`; paid Invoices are not reopened.

## AI intent beta

Natural-language handling is separately gated by global `AGENT_AI_ENABLED`, per-Creator
`agentAiEnabled`, and explicit Creator consent. Slash Commands remain available when AI is off.

- German and English text only, maximum 750 characters.
- OpenAI Responses API with strict Structured Outputs, `store:false`, and no model tools.
- Read intents execute under `ActorContext`.
- Mutations become ten-minute structured Drafts and require a Telegram confirmation callback.
- KaspaLinks stores no prompt or raw model response.
- Usage metadata is retained for 90 days; aggregate quota buckets remain.
- Creator quotas are 5/minute, 25/day, and 100/month.
- The global monthly kill switch is 2,000 requests or USD 5 in estimated cost, whichever comes
  first.

Provider-side abuse-monitoring retention may still apply; `store:false` is not a promise of zero
provider retention. Model name and operational token prices are deployment configuration, and
invalid price values fail closed.

## Notification rules

Persistent rules support all payments, one Action, a minimum amount, or one Action plus a minimum.
AI may prepare a rule Draft, but confirmation is mandatory. A completed Invoice rule transitions to
`Completed` only after its merged Outbox delivery succeeds, so a global notification and a matching
rule never produce duplicate messages.

## Operations

Required beta variables are documented in `.env.example`. Apply the database migration before
enabling the worker. Register the Telegram webhook only after the app and worker images are healthy:

```sh
docker compose run --rm agent-worker \
  pnpm --filter @kaspa-actions/agent-worker telegram:webhook:set
```

Rollback is immediate: set `AGENT_WORKER_ENABLED=false` and `AGENT_AI_ENABLED=false`, recreate the
containers, and optionally revoke per-Creator beta access. Normal KaspaLinks payment flows continue
to work.
