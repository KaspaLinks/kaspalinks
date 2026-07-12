#!/usr/bin/env bash
#
# kaspa-backup.sh — daily Postgres dump for kaspa-actions
#
# Snapshots the kaspa_actions database from inside the running Postgres
# container, gzip-compresses it, writes it to /var/backups/kaspa-actions/, and
# prunes old dumps according to a daily / weekly / monthly retention policy.
#
# Designed to be driven by the bundled systemd timer (kaspa-backup.timer) once
# per day. Re-running on the same date is safe — it overwrites that day's file
# atomically.
#
# Restoring a snapshot:
#
#   gunzip < /var/backups/kaspa-actions/daily/kaspa_actions-YYYY-MM-DD.sql.gz \
#     | docker exec -i kaspa-actions-postgres-1 \
#         psql -U kaspa_actions -d kaspa_actions
#
# The dump includes DROP/CREATE for every table (--clean --if-exists), so the
# restore stomps over whatever was in the DB. That's deliberate for disaster-
# recovery; do NOT pipe a dump into a healthy DB.

set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-kaspa-actions-postgres-1}"
DB_USER="${POSTGRES_USER:-kaspa_actions}"
DB_NAME="${POSTGRES_DB:-kaspa_actions}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/kaspa-actions}"

# Retention windows. Keep the most-recent N files in each bucket.
DAILY_KEEP="${DAILY_KEEP:-7}"
WEEKLY_KEEP="${WEEKLY_KEEP:-4}"
MONTHLY_KEEP="${MONTHLY_KEEP:-6}"

today="$(date -u +%Y-%m-%d)"
weekday="$(date -u +%u)"      # 1..7, Monday = 1
day_of_month="$(date -u +%d)"

mkdir -p "$BACKUP_ROOT"/{daily,weekly,monthly}
chmod 700 "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"/{daily,weekly,monthly}

daily_file="$BACKUP_ROOT/daily/kaspa_actions-$today.sql.gz"
weekly_file="$BACKUP_ROOT/weekly/kaspa_actions-$today.sql.gz"
monthly_file="$BACKUP_ROOT/monthly/kaspa_actions-$today.sql.gz"

# Verify the postgres container is up before dumping. Better to fail loud than
# silently miss a backup window.
if ! docker inspect --format='{{.State.Running}}' "$CONTAINER" >/dev/null 2>&1; then
  echo "kaspa-backup: container '$CONTAINER' is not running" >&2
  exit 1
fi

# Stream pg_dump into gzip into a tmpfile, then atomically move it into the
# daily slot. Using a tmpfile means a crashed dump never leaves a half-written
# file behind that retention pruning would treat as a valid backup.
tmp_file="$(mktemp --tmpdir="$BACKUP_ROOT/daily" --suffix=.sql.gz.partial)"
trap 'rm -f "$tmp_file"' EXIT

# pg_dump runs inside the postgres container, talking to the local UNIX
# socket — no password handling on the host. The official postgres image
# trusts local socket connections for the configured POSTGRES_USER.
#
# Flags:
#   --format=plain     human-readable, restorable with `psql` (no pg_restore)
#   --no-owner         strip OWNER TO statements so any user can restore
#   --no-acl           strip GRANT/REVOKE — restore env will set its own ACLs
#   --clean --if-exists  prepend DROP TABLE IF EXISTS so restore is idempotent
docker exec -i "$CONTAINER" pg_dump \
    --username="$DB_USER" \
    --dbname="$DB_NAME" \
    --format=plain \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
  | gzip -6 > "$tmp_file"

# Sanity check — a successful empty-DB dump is still > 1 KB (header + grants).
# Anything smaller almost certainly means pg_dump crashed silently.
if [[ "$(wc -c <"$tmp_file")" -lt 1024 ]]; then
  echo "kaspa-backup: dump suspiciously small (<1KB), aborting" >&2
  exit 1
fi

mv "$tmp_file" "$daily_file"
trap - EXIT

# Weekly snapshot on Mondays.
if [[ "$weekday" == "1" ]]; then
  cp -p "$daily_file" "$weekly_file"
fi

# Monthly snapshot on the 1st.
if [[ "$day_of_month" == "01" ]]; then
  cp -p "$daily_file" "$monthly_file"
fi

# Prune: keep the most-recent N of each bucket. `find` is used instead of a
# bare `ls *.sql.gz` glob because an empty bucket would make the glob expand
# to a non-matching pattern, which `ls` exits non-zero on, which `set -e`
# would treat as a script failure. `find` is happy with empty results.
prune_bucket() {
  local dir="$1"
  local keep="$2"
  find "$dir" -maxdepth 1 -type f -name '*.sql.gz' -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | tail -n +$((keep + 1)) \
    | cut -d' ' -f2- \
    | xargs -r rm -f
}

prune_bucket "$BACKUP_ROOT/daily" "$DAILY_KEEP"
prune_bucket "$BACKUP_ROOT/weekly" "$WEEKLY_KEEP"
prune_bucket "$BACKUP_ROOT/monthly" "$MONTHLY_KEEP"

size="$(du -h "$daily_file" | cut -f1)"
echo "kaspa-backup: wrote $daily_file ($size)"

# ---------------------------------------------------------------------------
# OFF-VPS UPLOAD (optional, off by default)
#
# Backups stored only on this VPS share the VPS's fate. If you've provisioned
# a Hetzner Storage Box (or any other rsync-over-SSH target), set
# STORAGE_BOX_REMOTE in /etc/default/kaspa-backup to enable mirrored uploads,
# e.g.:
#
#     STORAGE_BOX_REMOTE="u123456@u123456.your-storagebox.de:/kaspa-actions"
#     STORAGE_BOX_SSH_KEY="/root/.ssh/storage_box_ed25519"
#
# The service unit will source that file before invoking this script. If the
# variable is empty (default), the upload step is skipped silently.
# ---------------------------------------------------------------------------
if [[ -n "${STORAGE_BOX_REMOTE:-}" ]]; then
  ssh_opt=()
  if [[ -n "${STORAGE_BOX_SSH_KEY:-}" ]]; then
    ssh_opt=(-e "ssh -i $STORAGE_BOX_SSH_KEY -o StrictHostKeyChecking=accept-new")
  fi
  rsync -av --delete "${ssh_opt[@]}" "$BACKUP_ROOT/" "$STORAGE_BOX_REMOTE/" \
    || echo "kaspa-backup: rsync to $STORAGE_BOX_REMOTE failed (backup still on VPS)" >&2
fi
