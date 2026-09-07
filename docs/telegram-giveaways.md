# Telegram giveaways

Implemented on 6 September 2026. BotFather Main Mini App activation remains pending.

## Participant flow

The Telegram Main Mini App opens `/telegram`. A shared public link uses
`https://t.me/<bot>?startapp=g_<publicId>`. It displays the existing public giveaway
entry page inside Telegram, with the same address validation, Turnstile, funding,
draw-proof and payout checks. The start parameter is navigation only and never
confers Creator authorization. Existing browser URLs continue to work.

The participant may share a prepared Telegram card. The backend validates signed,
recent initData and binds the prepared message to that Telegram user. It derives
all card fields from the giveaway; it accepts no caller-supplied amount, creator,
URL or funding assertion. The user chooses the chat and confirms sending inside
Telegram. Older clients and ordinary browsers use Telegram's share-link dialog.
The client checks `isVersionAtLeast("8.0")` before calling `shareMessage`, as
required by the [Telegram Mini App API](https://core.telegram.org/bots/webapps#initializing-mini-apps).
Cards contain public IDs, title, amount, creator, status and deadline. Neither
claim/refund material nor signed transactions appear in cards, start parameters or
notification payloads. Displayed funding is a snapshot; the entry page checks the
current state.

`/start g_<publicId>` is an alternative entry via the bot's private chat. It works
without a Creator account and offers an Open giveaway Mini App button.

## Explicit result reminders

“Notify me of the result” opens `/start watch_<publicId>`. Starting the bot does not
subscribe the user. The user must press “Notify me of the result” in the private
chat. This creates a `TelegramGiveawaySubscription`, separate from
`TelegramConnection` and Creator permissions. A subscription is not proof of entry
or wallet ownership. It may also follow a public giveaway without entering.

The result message points to the public result page and never asserts that its
recipient won. Each subscription has one deduplicated result for DRAWN,
NO_ENTRIES or CANCELLED. The bot offers a per-giveaway off button; `/stop` disables
all of that user's giveaway reminders, independently of Creator payment alerts.
At most 50 pending active subscriptions are allowed per user. Repeated opt-in
preserves the existing subscription and never resets a delivered result.

The worker re-reads current authorization immediately before sending. Revoked or
deleted subscriptions are suppressed, including queued deliveries. Re-enabling
an unsent, suppressed result allows it to retry. A request already in flight at
the instant of revocation cannot be recalled. Network acknowledgement uncertainty
can still cause duplicate Telegram messages; an outbox does not provide an
exactly-once guarantee across the Telegram API.

## Draw processing

Every 15 seconds the worker calls the private application's authenticated
`POST /api/agent/giveaways/tick`. The endpoint selects up to three due giveaways
with active pending subscribers. An observed-timestamp update prevents duplicate
claims across concurrent workers. Each giveaway is retried at most once per
30 seconds and older checks are processed first.

Public and scheduled draws share `src/lib/giveaway-draw.ts`. They use the existing
frozen-entry, future-chain-entropy and funding rules. If chain data is temporarily
unavailable, the result remains pending. No creator browser is needed to advance
these subscribed draws. The creator's browser is still required to sign the
winner's payout, exactly as before.

Result queuing atomically marks the subscription and creates its uniquely keyed
outbox row. Queue processing recovers after restarts and catches results already
committed before an outage. It is separate from payment confirmation.

## Creating a giveaway from a template

“Create my own giveaway” opens the existing Creator setup with a public template
ID. Title, amount and duration are copied as editable settings. No funding,
participant, recovery or authorization data is copied. A Creator sign-in or new
profile preserves the destination, including the template. Issued Creator tokens
still must be saved by the user and remain in sessionStorage only.

Creator signup remains controlled by the existing deployment setting. This change
does not bypass the beta allowlist for linking a Creator account to the bot.
Participants do not need that allowlist. A signed-in web Creator may create and
fund through the normal browser workflow.

## Related reliability fixes

- Giveaway command drafts use a unique source update ID, so Telegram retries reuse
  the same draft and do not extend its expiry.
- Fresh connection codes can restore a blocked same-chat Creator connection.
- Nested Telegram message/callback fields are validated and commands are limited
  per Telegram user using the existing single-app in-memory limiter.
- Telegram `retry_after` is honored. Invalid-message 400 errors dead-letter that
  delivery; only unreachable-chat errors disable a connection/subscription.
- Payment deliveries re-read current connection/rule settings and remove stored
  supporter details when their inclusion was disabled. The global payment switch
  is labeled “Notify me of all payments”; independently enabled rules still apply.
- Unknown prize spends have an explicit bot status label.

## Deployment

1. Run the full repository checks and apply all pending migrations, including
   `20260906090000_telegram_giveaway_participants` and the preceding review migration.
2. Build/recreate app and worker with `APP_COMMIT_SHA`. Preserve all existing
   database, log and recovery storage.
3. Configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
   `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, `AGENT_WORKER_ENABLED=true`,
   `TOCCATA_LAB_ENABLED=true` and `GIVEAWAY_LAB_ENABLED=true`.
   Compose supplies the worker with `AGENT_INTERNAL_APP_URL=http://app:3000`.
   For local development, set that URL to the local app port. Never set it to an
   untrusted host: it receives the webhook credential.
4. In BotFather, enable/configure the Main Mini App with the HTTPS URL
   `https://<domain>/telegram`. The configured bot username must match this bot.
   No inline-mode activation is needed for prepared share messages.
5. Apply Caddy configuration and re-register the webhook/command menu with the
   existing `telegram:webhook:set` worker command to expose `/stop`.
6. Verify with an unconnected participant account on Telegram iOS, Android and Web:
   shared card -> entry -> explicit reminder -> completed draw -> result page;
   revoke before draw; check that no reminder arrives; create a template-based
   giveaway and complete Creator sign-in/signup without losing its settings.

Caddy allows framing by `https://web.telegram.org` only on the Mini App/giveaway
pages and their sign-in/signup continuation. Other pages retain frame denial.
Credential header redaction and private application/database/relay ingress remain
required.

## Local verification

Focused tests cover public starts without implicit opt-in, private callback
ownership, malformed updates, signed/expired/tampered share identities, source
update deduplication, subscription limits, cancellation, outbox authorization,
Telegram errors/backoff and the scheduled draw boundary. Existing draw tests run
against the extracted shared engine.

`packages/db/verification/telegram-giveaways.mjs` accepts an independently installed
PGlite module. It runs all migrations in an isolated PostgreSQL/WASM database and
checks unique subscriptions, source update IDs, outbox keys, transaction rollback
and giveaway deletion behavior. It never reads DATABASE_URL or contacts a database
server. Native PostgreSQL concurrency and actual Telegram delivery remain rollout
checks.

Completed locally on 6 September 2026:

- `pnpm lint` and `pnpm typecheck`: passed.
- `pnpm test`: 766 tests in 123 files passed.
- `pnpm build`: passed; the existing vendored Kaspa WASM dynamic-dependency
  warning remains.
- Isolated PGlite verification: all 28 migrations and the new constraints,
  rollback and deletion checks passed.
- Native Caddy 2.11.4 validation and loopback HTTP checks: configuration valid;
  Telegram framing allowed only on the specified pages, with frame denial
  preserved for dashboard and API routes.
- Mobile Chrome/Playwright smoke check at 390px against the production build:
  participant view, prepared sharing, older-client share fallback, entry,
  reminder link and template-to-signup navigation passed without overflow or
  page errors. API responses and the Telegram bridge were mocked; no real
  Telegram messages, database writes or wallet transactions were performed.

No BotFather change or live giveaway entry/payout test was performed.
