#!/usr/bin/env bash
# BrewDial HeatWave backup: mysqldump --single-transaction of the brewdial schema
# with retention (KEEP_DAILY daily + KEEP_WEEKLY weekly) and a healthchecks.io
# dead-man's-switch ping. Run on the OCI box by brewdial-backup.timer (daily). This
# is the box-local copy (copy 1); the Mac pulls it off-box (copy 2).
#
# Config: /etc/brewdial/backup.env (see backup.env.example). Credentials stay in
# the file that HEATWAVE_ENV names (see heatwave.env.example) and are never printed.
set -Eeuo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=heatwave-client.sh
. "$here/heatwave-client.sh"

CONFIG="${BREWDIAL_BACKUP_ENV:-/etc/brewdial/backup.env}"
# shellcheck source=/dev/null
[ -r "$CONFIG" ] && . "$CONFIG"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/brewdial}"
HEATWAVE_ENV="${HEATWAVE_ENV:-/etc/brewdial/heatwave.env}"
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
trap heatwave_unload EXIT

hc start

[ -r "$HEATWAVE_ENV" ] || { log "$HEATWAVE_ENV is not readable"; false; }
heatwave_load "$HEATWAVE_ENV"

stamp="$(date -u +%Y%m%d-%H%M)"
dow="$(date -u +%u)"   # 1..7, 7 = Sunday
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
daily_file="$BACKUP_DIR/daily/brewdial-$stamp.sql.gz"

log "mysqldump --single-transaction -> $daily_file"
heatwave_dump | gzip -9 >"$daily_file.partial"
heatwave_check_dump "$daily_file.partial"
mv "$daily_file.partial" "$daily_file"
log "dump OK ($(du -h "$daily_file" | cut -f1))"

if [ "$dow" = "7" ]; then
  cp -p "$daily_file" "$BACKUP_DIR/weekly/brewdial-$stamp.sql.gz"
  log "promoted to weekly"
fi

# Filenames are timestamped (…-YYYYMMDD-HHMM), so reverse lexical sort = newest-first.
# PostgreSQL *.dump files from before the cutover age out by hand (runbook).
prune() {  # prune <dir> <keep>
  local dir="$1" keep="$2" f i=0
  for f in $(find "$dir" -maxdepth 1 -type f -name '*.sql.gz' 2>/dev/null | sort -r); do
    i=$((i + 1)); [ "$i" -gt "$keep" ] && { log "prune $f"; rm -f "$f"; }
  done
  return 0
}
prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

count() { find "$1" -maxdepth 1 -type f -name '*.sql.gz' 2>/dev/null | wc -l | tr -d ' '; }
log "backup complete (daily=$(count "$BACKUP_DIR/daily") weekly=$(count "$BACKUP_DIR/weekly"))"
hc
