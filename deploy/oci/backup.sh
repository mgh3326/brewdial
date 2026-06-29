#!/usr/bin/env bash
# BrewDial OCI Postgres backup — pg_dump -Fc of DB `brewdial` (+ cluster globals),
# with retention (KEEP_DAILY daily + KEEP_WEEKLY weekly) and a healthchecks.io
# dead-man's-switch ping. Run on the OCI box by brewdial-backup.timer (daily).
# This is the box-local copy (copy 1); the Mac pulls it off-box (copy 2).
#
# Config lives in /etc/brewdial/backup.env (see backup.env.example) — secrets stay
# on the box, never in the repo. Part of ROB-630 (Supabase decommission gate);
# full procedure in the ROB-630 backup/restore runbook.
set -euo pipefail

CONFIG="${BREWDIAL_BACKUP_ENV:-/etc/brewdial/backup.env}"
# shellcheck source=/dev/null
[ -r "$CONFIG" ] && . "$CONFIG"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/brewdial}"
API_ENV="${API_ENV:-/etc/brewdial/api.env}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
HC_PING_URL="${HC_PING_URL:-}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Best-effort healthchecks.io ping; never fails the backup itself.
hc() {
  [ -n "$HC_PING_URL" ] || return 0
  curl -fsS -m 10 --retry 3 "${HC_PING_URL}${1:+/$1}" -o /dev/null || true
}

on_err() { log "BACKUP FAILED (line $1)"; hc fail; }
trap 'on_err "$LINENO"' ERR

hc start

# --- resolve DSN from the API env (same source brewdial-api.service uses) ---
if [ -r "$API_ENV" ]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$API_ENV" | cut -d= -f2-)"
fi
: "${DATABASE_URL:?DATABASE_URL not found (check $API_ENV)}"

stamp="$(date -u +%Y%m%d-%H%M)"
dow="$(date -u +%u)"   # 1..7, 7 = Sunday
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/globals"

daily_file="$BACKUP_DIR/daily/brewdial-$stamp.dump"
globals_file="$BACKUP_DIR/globals/globals-$stamp.sql"

# --- 1. database dump (custom format, faithful: owners/privs preserved for DR) ---
log "pg_dump -Fc brewdial -> $daily_file"
pg_dump -Fc "$DATABASE_URL" > "$daily_file.partial"
mv "$daily_file.partial" "$daily_file"
# A custom-format archive must list its TOC; if this fails the dump is corrupt.
pg_restore -l "$daily_file" > /dev/null
log "dump OK ($(du -h "$daily_file" | cut -f1))"

# --- 2. cluster globals (roles/grants) — NOT in -Fc; needed to rebuild brewdial_app on a fresh box ---
# Best-effort: requires a superuser. Non-fatal if peer/sudo isn't available.
if sudo -n -u postgres pg_dumpall --globals-only > "$globals_file.partial" 2>/dev/null; then
  mv "$globals_file.partial" "$globals_file"
  log "globals OK ($(du -h "$globals_file" | cut -f1))"
else
  rm -f "$globals_file.partial"
  log "WARN: globals dump skipped (sudo -u postgres pg_dumpall unavailable) — see runbook for manual capture"
fi

# --- 3. retention ---
# weekly promotion: on Sunday keep a copy in weekly/
if [ "$dow" = "7" ]; then
  cp -p "$daily_file" "$BACKUP_DIR/weekly/brewdial-$stamp.dump"
  log "promoted to weekly"
fi

# Filenames are timestamped (…-YYYYMMDD-HHMM), so reverse lexical sort = newest-first.
prune() {  # prune <dir> <ext> <keep>
  local dir="$1" ext="$2" keep="$3" f i=0
  for f in $(find "$dir" -maxdepth 1 -type f -name "*.$ext" 2>/dev/null | sort -r); do
    i=$((i + 1)); [ "$i" -gt "$keep" ] && { log "prune $f"; rm -f "$f"; }
  done
  return 0
}
prune "$BACKUP_DIR/daily"   dump "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly"  dump "$KEEP_WEEKLY"
prune "$BACKUP_DIR/globals" sql  "$KEEP_DAILY"

count() { find "$1" -maxdepth 1 -type f -name "*.$2" 2>/dev/null | wc -l | tr -d ' '; }
log "backup complete (daily=$(count "$BACKUP_DIR/daily" dump) weekly=$(count "$BACKUP_DIR/weekly" dump))"
hc
