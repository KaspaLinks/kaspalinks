# Postgres backup for kaspa-actions

Automated daily snapshot of the production Postgres database, with daily /
weekly / monthly retention and an optional off-VPS rsync upload step.

## Why this exists

The app runs Postgres in a single Docker volume on a single Hetzner VPS. If
that volume gets corrupted, the disk dies, or someone runs
`docker compose down -v` by accident, **every creator + payment record is
gone**. These backups are the one thing standing between "small embarrassment"
and "the platform is over". Treat the timer like the smoke detector it is.

## What gets backed up

`pg_dump` against the `kaspa_actions` database, gzipped, plain-SQL format —
restorable with stock `psql` (no `pg_restore` required). Three retention
buckets, all under `/var/backups/kaspa-actions/`:

- `daily/` — last 7 days
- `weekly/` — last 4 Mondays
- `monthly/` — last 6 1st-of-month dumps

A fresh production DB dumps to roughly 50–200 KB compressed; a year of all
buckets at expected user volumes fits comfortably under 100 MB.

## Install on the VPS

Run once, as root:

```bash
cd /opt/kaspa-actions

# 1. Drop the script into the standard host bin and make it executable.
install -m 0755 deploy/db-backup/kaspa-backup.sh /usr/local/bin/kaspa-backup.sh

# 2. Drop in the systemd units.
install -m 0644 deploy/db-backup/kaspa-backup.service /etc/systemd/system/
install -m 0644 deploy/db-backup/kaspa-backup.timer   /etc/systemd/system/

# 3. Tell systemd to re-read units and enable the timer.
systemctl daemon-reload
systemctl enable --now kaspa-backup.timer

# 4. Force one immediate run to verify everything works end-to-end.
systemctl start kaspa-backup.service
journalctl -u kaspa-backup.service -n 30 --no-pager
ls -lh /var/backups/kaspa-actions/daily/
```

The last command should show one `kaspa_actions-YYYY-MM-DD.sql.gz` file with
a size in the kilobyte range. If it's there, the timer is live.

To confirm the timer is scheduled:

```bash
systemctl list-timers kaspa-backup.timer
```

## Optional: mirror to a Hetzner Storage Box (off-VPS)

Local-only backups die with the VPS. To survive a full-VPS loss, mirror to a
Hetzner Storage Box (~€3/month for 100 GB, separate physical infrastructure
inside the same DC region).

1. Create a Storage Box in the Hetzner console and enable SSH access.
2. Generate a dedicated SSH key on the VPS:
   ```bash
   ssh-keygen -t ed25519 -f /root/.ssh/storage_box_ed25519 -N ''
   ssh-copy-id -i /root/.ssh/storage_box_ed25519 -p 23 \
     u123456@u123456.your-storagebox.de
   ```
3. Create `/etc/default/kaspa-backup` with two lines:
   ```sh
   STORAGE_BOX_REMOTE="u123456@u123456.your-storagebox.de:/kaspa-actions"
   STORAGE_BOX_SSH_KEY="/root/.ssh/storage_box_ed25519"
   ```
4. Re-run the backup once to verify the upload:
   ```bash
   systemctl start kaspa-backup.service
   journalctl -u kaspa-backup.service -n 50 --no-pager
   ```

The script will then `rsync --delete` the full retention tree to the Storage
Box after each successful local dump. `--delete` keeps the remote tree in
sync with local retention — old snapshots that age out locally also age out
on the box.

## Restore

The dump format is plain SQL with `DROP IF EXISTS` + `CREATE` for every
table, so restoring stomps over whatever is in the DB. **Never restore into
a healthy production DB** — only after the data is gone or the DB is empty.

```bash
# Pick the dump you want to restore from.
ls /var/backups/kaspa-actions/daily/

# Pipe it into the running container.
gunzip < /var/backups/kaspa-actions/daily/kaspa_actions-2026-05-18.sql.gz \
  | docker exec -i kaspa-actions-postgres-1 \
      psql -U kaspa_actions -d kaspa_actions
```

For a clean-slate restore (e.g. on a brand new VPS):

```bash
docker compose up -d postgres
gunzip < kaspa_actions-2026-05-18.sql.gz \
  | docker exec -i kaspa-actions-postgres-1 \
      psql -U kaspa_actions -d kaspa_actions
docker compose up -d app
```

## Troubleshooting

- **`container 'kaspa-actions-postgres-1' is not running`** — the docker
  container name changed (e.g. compose project rename). Override via
  `POSTGRES_CONTAINER` env in `/etc/default/kaspa-backup`.
- **`dump suspiciously small (<1KB)`** — pg_dump probably hit an auth or
  permission error inside the container. Reproduce manually:
  `docker exec -it kaspa-actions-postgres-1 pg_dump -U kaspa_actions -d kaspa_actions | head`.
- **Timer is scheduled but never fires** — check `journalctl -u kaspa-backup.timer`
  and verify `systemctl is-active kaspa-backup.timer` is `active`.
