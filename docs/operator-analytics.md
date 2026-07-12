# Operator Analytics

Kaspa Links can show a private operator dashboard at `/operator-stats`.

This is intentionally server-side and simple:

- Caddy writes rolling access logs to a Docker volume.
- The Next.js app mounts that volume read-only.
- `/operator-stats` reads recent log lines, deduplicates page views, and stores them in
  PostgreSQL.
- No tracking scripts, tracking cookies, third-party analytics, or external dashboards are added.
- Raw IP addresses are not displayed in the dashboard and are not written to the app database.
  The database stores daily visitor hashes only, which are used for approximate unique counts.

## What It Shows

- human page views for the last 24 hours, 7 days, and 30 days
- tracked page views across all stored operator analytics data
- approximate unique visitors, deduplicated by daily IP/browser hash
- top pages
- referrers such as X / Twitter, Discord, Google, Reddit, or direct traffic
- `utm_source` parameters
- mobile, tablet, desktop, and bot/previews
- browser mix
- country dots on a lightweight built-in map when a trusted proxy country header is available

Country data is best-effort. Plain Caddy access logs do not know the visitor country by
themselves. `deploy/Caddyfile` is prepared for Cloudflare by trusting Cloudflare edge IP ranges,
reading the real visitor IP from `CF-Connecting-IP`, and enabling strict proxy parsing. The
dashboard accepts country headers such as `CF-IPCountry` only when the log entry came through a
trusted proxy. Direct-origin requests with spoofed country headers are treated as unknown.

To make country dots appear:

1. Put the domain behind Cloudflare's proxied DNS mode.
2. Enable Cloudflare IP Geolocation so Cloudflare sends `CF-IPCountry` to the origin.
3. Keep the origin reachable only through Caddy; ideally firewall direct non-Cloudflare traffic
   once Cloudflare is active.

Without Cloudflare or another trusted GeoIP proxy, most visits will appear as unknown country.

## Access Control

The public site is not behind a shared password. Keep `/operator-stats` behind the separate
operator-only Basic Auth gate in `deploy/Caddyfile`. Do not expose it as a public route.

## Log Retention

The Docker setup writes logs to the `caddy_logs` volume and rolls them at:

- `mode 0644` so the app container can read the mounted log file
- `roll_size 20MiB`
- `roll_keep 10`
- `roll_keep_for 720h` (30 days)

The Caddy log encoder deletes these request headers before writing access logs:

- `Authorization`
- `Proxy-Authorization`
- `Cookie`

This keeps Basic Auth, bearer tokens, and browser cookies out of the analytics log.

`OperatorPageView` keeps deduplicated page-view records in PostgreSQL so all-time totals do not
shrink when Caddy rotates log files. If you need to reset the private operator analytics, truncate
that table deliberately:

```sh
TRUNCATE TABLE "OperatorPageView";
```
