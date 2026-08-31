# Telegram Mini App uses scoped init data

The Telegram Mini App authenticates each Giveaway request with recently signed Telegram `initData`
that maps to an existing one-to-one Creator connection. This identity is accepted only by the
Giveaway and associated prize-registration routes; it never becomes a general Creator token, and
browser-generated recovery material remains outside Telegram and the server.
