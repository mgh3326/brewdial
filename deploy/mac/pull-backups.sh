#!/usr/bin/env bash
# Pull BrewDial OCI box backups to this Mac — the off-box copy (copy 2) for
# ROB-630. Run by launchd (com.brewdial.backup-pull) daily, after the box's
# 03:30 UTC dump. Pulls WITHOUT rsync --delete so a box-side mass deletion
# (accidental rm / compromise) cannot propagate and wipe the off-box copy;
# a generous Mac-side prune bounds growth while keeping more history than the box.
#
# Config: ~/.brewdial-backup.env (see backup-pull.env.example). HC URL stays there.
set -euo pipefail

CONFIG="${BREWDIAL_PULL_ENV:-$HOME/.brewdial-backup.env}"
# shellcheck source=/dev/null
[ -r "$CONFIG" ] && . "$CONFIG"

SSH_KEY="${SSH_KEY:-$HOME/.ssh/ssh-key-2026-06-23.key}"
BOX="${BOX:-opc@140.245.42.173}"
REMOTE_DIR="${REMOTE_DIR:-/var/backups/brewdial/}"
LOCAL_DIR="${LOCAL_DIR:-$HOME/brewdial-backups}"
HC_PING_URL="${HC_PULL_PING_URL:-}"
KEEP_DAILY="${KEEP_DAILY:-30}"     # Mac keeps more history than the box (7)
KEEP_WEEKLY="${KEEP_WEEKLY:-12}"
KEEP_GLOBALS="${KEEP_GLOBALS:-30}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
hc()  { [ -n "$HC_PING_URL" ] || return 0; curl -fsS -m 10 --retry 3 "${HC_PING_URL}${1:+/$1}" -o /dev/null || true; }
on_err() { log "PULL FAILED (line $1)"; hc fail; }
trap 'on_err "$LINENO"' ERR

hc start
mkdir -p "$LOCAL_DIR"
log "rsync $BOX:$REMOTE_DIR -> $LOCAL_DIR (no --delete)"
rsync -az -e "ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new" \
  "$BOX:$REMOTE_DIR" "$LOCAL_DIR/"

newest="$(find "$LOCAL_DIR/daily" -maxdepth 1 -type f -name '*.dump' 2>/dev/null | sort -r | head -1)"
[ -n "$newest" ] || { log "no daily dump present after pull"; hc fail; exit 1; }
log "newest local dump: $newest ($(du -h "$newest" | cut -f1))"
# If a Postgres client is installed, confirm the pulled archive isn't truncated.
if command -v pg_restore >/dev/null 2>&1; then
  pg_restore -l "$newest" >/dev/null && log "archive TOC OK (pg_restore -l)"
fi

prune() {  # prune <dir> <ext> <keep>
  local dir="$1" ext="$2" keep="$3" f i=0
  for f in $(find "$dir" -maxdepth 1 -type f -name "*.$ext" 2>/dev/null | sort -r); do
    i=$((i + 1)); [ "$i" -gt "$keep" ] && { log "prune $f"; rm -f "$f"; }
  done
  return 0
}
prune "$LOCAL_DIR/daily"   dump "$KEEP_DAILY"
prune "$LOCAL_DIR/weekly"  dump "$KEEP_WEEKLY"
prune "$LOCAL_DIR/globals" sql  "$KEEP_GLOBALS"

count() { find "$1" -maxdepth 1 -type f -name "*.$2" 2>/dev/null | wc -l | tr -d ' '; }
log "pull complete ($(count "$LOCAL_DIR/daily" dump) daily on Mac)"
hc
