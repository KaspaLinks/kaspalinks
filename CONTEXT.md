# KaspaLinks

KaspaLinks turns Kaspa payment intent into links that can be created, shared, paid, and observed without taking custody of funds.

## Language

**Agent**:
The channel-independent interface through which a Creator uses KaspaLinks capabilities.
_Avoid_: Telegram bot, AI bot

**Channel Adapter**:
A delivery-specific interface that translates between an external channel and Agent Commands.
_Avoid_: Business service

**Command**:
An explicit Creator instruction with deterministic meaning and immediate execution.
_Avoid_: Prompt, intent

**AI Intent**:
A strictly structured interpretation of free text that can be read immediately or confirmed as a Draft.
_Avoid_: AI command, autonomous action

**Application Tool**:
An authorized KaspaLinks use case executed for a server-authenticated Actor.
_Avoid_: Public tool API, model tool

**Actor**:
The authenticated Creator identity on whose behalf an Application Tool runs.
_Avoid_: Owner parameter, user-supplied creator ID

**Payment Event**:
The durable fact that one Payment Request was confirmed on chain.
_Avoid_: Notification, webhook

**Notification Rule**:
A persistent Creator preference that decides whether a matching Payment Event deserves notification.
_Avoid_: Payment trigger

**Outbox Delivery**:
A durable, deduplicated attempt to deliver one channel notification for a Payment Event.
_Avoid_: Payment Event

**Draft**:
A structured, expiring proposal that cannot mutate KaspaLinks until its Creator explicitly confirms it.
_Avoid_: Pending command

**Giveaway Setup Draft**:
An expiring set of public Giveaway settings that an Agent hands to the Creator's browser for review and completion.
_Avoid_: Giveaway, funded Giveaway, prize wallet

**Claimable Link**:
A browser-signed Kaspa reward whose private claim and refund material never reaches the server or Agent.
_Avoid_: Agent payment
