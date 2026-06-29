# ROB-630 — OCI Postgres backup + restore runbook

**Status:** backup + verified-restore gate implemented and proven against live data
(2026-06-29). This is the **precondition gate** for decommissioning Supabase
(epic ROB-618 / parent ROB-619).

## Why this exists

The Supabase→OCI migration is live (web / `.ait` / MCP all use the OCI backend).
But OCI is a **single instance (SPOF)** and, until this issue, had **zero backups** —
so Supabase was effectively the only backup. Backend code/deploy is reproducible
from git+rsync, but the **data (recipes, beans, feedback, gear, …) lives only on OCI**.
This gives us a verified, off-box, restorable backup so Supabase can be torn down.

## Architecture — two copies + a verification gate

| Copy | Where | How | Cost |
|------|-------|-----|------|
| 1 — box-local | OCI box `/var/backups/brewdial/{daily,weekly,globals}` | `brewdial-backup.timer` → `backup.sh` (`pg_dump -Fc` + `pg_dumpall --globals-only`), retention **7 daily + 4 weekly** | free (box disk, 171 GB free) |
| 2 — off-box | this Mac `~/brewdial-backups/` | launchd `com.brewdial.backup-pull` → `pull-backups.sh` (`rsync`, **no `--delete`**), retention 30 daily | free |

**Gate:** `brewdial-verify.timer` → `verify-restore.sh` restores a dump into a
throwaway `brewdial_verify` DB and asserts it is **byte-faithful to live**
(row count + whole-row content checksum for 12 core tables, 4 sentinel tables,
and `recipe_code_seq`). Any mismatch → non-zero exit + healthchecks `/fail`.

A full `pg_dump -Fc` restore is **trigger-clean** (data is `COPY`ed before triggers
are created), so the `recipes` guard/link triggers cannot mutate restored rows.
PG17 → PG17, so whole-row `::text` checksums are exact.

Off-box egress is trivial: a dump is ~160 KB; daily pull ≈ 5 MB/month vs OCI's
10 TB/month free outbound.

## Components (in the repo)

- `deploy/oci/backup.sh` — daily dump + globals + retention + healthchecks ping
- `deploy/oci/brewdial-backup.{service,timer}` — daily 03:30 UTC
- `deploy/oci/verify-restore.sh` — the restore-verification gate
- `deploy/oci/brewdial-verify.{service,timer}` — weekly Mon 04:10 UTC
- `deploy/oci/backup.env.example` → `/etc/brewdial/backup.env` (HC URLs; chmod 600)
- `deploy/mac/pull-backups.sh` + `com.brewdial.backup-pull.plist` + `backup-pull.env.example`

Secrets (healthchecks ping URLs) live on the box/Mac in `*.env` files, never in git.

## Routine operation

- **03:30 UTC daily** — box dumps `brewdial` → `/var/backups/brewdial/daily/`, dumps
  globals, prunes to 7 daily / 4 weekly, pings healthchecks `brewdial-backup`.
- **~13:00 KST daily** — Mac pulls the box backups to `~/brewdial-backups/`, pings
  `brewdial-mac-pull`.
- **Mon 04:10 UTC weekly** — box runs `verify-restore.sh` (fresh dump → restore →
  compare), pings `brewdial-verify`.
- **Alerts**: each job pings healthchecks.io on success; a missing ping (job didn't
  run, or the box/Mac is down) or a `/fail` ping raises an alert. This dead-man's
  switch catches "backups silently stopped", which log-only alerting would miss.

### Reading a verify result

`GATE PASS ✅  (restored copy is byte-faithful to live brewdial)` with
`mismatches=0` → the latest dump restores and matches live exactly.
`GATE FAIL ❌` lists each mismatching table (`live=[count|hash] restored=[count|hash]`).
Note: a transient mismatch is *possible* if a write lands between the dump snapshot
and the live comparison (≈seconds). Re-run; if it persists, investigate before trusting the backup.

## Manual commands (on the box)

```bash
ssh -i ~/.ssh/ssh-key-2026-06-23.key opc@140.245.42.173

# run a backup now
sudo systemctl start brewdial-backup    # or: /opt/brewdial/deploy/oci/backup.sh
ls -la /var/backups/brewdial/daily/

# run the verification gate now (fresh dump)
/opt/brewdial/deploy/oci/verify-restore.sh

# verify a SPECIFIC stored artifact (use before Supabase teardown)
/opt/brewdial/deploy/oci/verify-restore.sh /var/backups/brewdial/daily/brewdial-YYYYMMDD-HHMM.dump

# timer status / logs
systemctl list-timers 'brewdial-*'
journalctl -u brewdial-backup -u brewdial-verify --since '-2 days'
```

## Disaster recovery — restore onto a fresh box

Use the latest dump from the Mac (`~/brewdial-backups/`) or the box. Steps:

1. **Provision** a new instance with **PostgreSQL 17** (see the M1 provisioning
   runbook, `2026-06-23-m1-oci-provisioning-runbook.md`). Ensure `pgcrypto` is available.
2. **Restore cluster globals** (recreates the `brewdial_app` role + grants — these
   are NOT in the `-Fc` dump):
   ```bash
   sudo -u postgres psql -f globals-YYYYMMDD-HHMM.sql
   ```
   If globals are missing, recreate the role manually:
   `CREATE ROLE brewdial_app LOGIN PASSWORD '…';` (then set the password to match `DATABASE_URL`).
3. **Create the DB and restore the data:**
   ```bash
   sudo -u postgres createdb -O brewdial_app brewdial
   sudo -u postgres pg_restore --exit-on-error -d brewdial brewdial-YYYYMMDD-HHMM.dump
   ```
   (Add `--no-owner` only if the `brewdial_app` role was not restored.)
4. **Verify the restore** before cutting traffic over:
   ```bash
   /opt/brewdial/deploy/oci/verify-restore.sh brewdial-YYYYMMDD-HHMM.dump
   # or spot-check: psql -c 'select count(*) from recipes;'  -> expect ~61
   ```
5. **Repoint the app**: set `DATABASE_URL` in `/etc/brewdial/api.env`, restart
   `brewdial-api`, confirm `GET /api/db/health` is green. Re-point Cloudflare Tunnel
   if the host changed.

If only the **box** is lost (Mac intact): the newest restorable artifact is in
`~/brewdial-backups/daily/`. If only the **Mac** is lost: the box still has 7+4 on disk.

## Pre-Supabase-teardown checklist (the gate)

Do NOT drop Supabase until ALL of these are true:

- [ ] `brewdial-backup.timer` + `brewdial-verify.timer` enabled and have fired ≥1 clean run.
- [ ] Off-box copy present on the Mac (`~/brewdial-backups/daily/` has the latest dump).
- [ ] **A manual `verify-restore.sh <latest stored dump>` returns `GATE PASS ✅`**
      (this is the authoritative evidence the off-box artifact restores faithfully).
- [ ] healthchecks.io checks are green and a deliberately-failed test ping produced an alert.
- [ ] This runbook's DR steps dry-run at least once (restore into `brewdial_verify` counts as the rehearsal).

Then follow the decommission order: **backup secured → `.ait` adoption confirmed →
Supabase read-only bake → Supabase drop (irreversible)**.

## Notes / deferred

- **PITR deferred.** Daily logical dumps give ~24h RPO, acceptable for v1's low write
  volume. Revisit WAL archiving only if RPO must drop below a day.
- **Cloud third copy deferred.** Box + Mac satisfies "local + 1 off-box". A future
  `rclone` push from the Mac to a free-tier bucket (e.g. Cloudflare R2) would add a
  third, geographically-separate copy.
- **Encryption:** dumps are not client-side encrypted (v1 is anonymous, no auth
  secrets/PII). The box and Mac directories are local; revisit if sensitive data is added.
