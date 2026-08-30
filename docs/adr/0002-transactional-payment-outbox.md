# Transactional payment events and outbox

A chain confirmation, invoice completion, audit entry, Payment Event, and any matching notification delivery are committed in one PostgreSQL transaction. This avoids lost or duplicated Telegram messages without making Telegram availability part of the payment confirmation path.
