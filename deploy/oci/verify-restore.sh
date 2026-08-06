#!/usr/bin/env bash
# BrewDial restore-verification — THE Supabase-decommission gate (ROB-630).
#
# Restores a pg_dump archive into a throwaway DB and asserts it is byte-faithful
# to the live `brewdial` DB: row count + whole-row content checksum for every
# core table, recipe_code_seq consistency (else new recipe codes collide), and
# schema-sentinel tables. ANY mismatch => non-zero exit + healthchecks /fail.
#
#   verify-restore.sh             # default: take a fresh consistent dump, restore, compare (deterministic)
#   verify-restore.sh <dump-file> # verify a specific STORED artifact (e.g. before Supabase teardown)
#
# Run weekly by brewdial-verify.timer; run once manually for the teardown gate.
# A full -Fc restore is trigger-clean (data COPYed before triggers are created),
# so the recipes guard/link triggers cannot mutate restored rows. PG17->PG17.
set -euo pipefail

CONFIG="${BREWDIAL_BACKUP_ENV:-/etc/brewdial/backup.env}"
# shellcheck source=/dev/null
[ -r "$CONFIG" ] && . "$CONFIG"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/brewdial}"
API_ENV="${API_ENV:-/etc/brewdial/api.env}"
VERIFY_DB="${VERIFY_DB:-brewdial_verify}"
HC_PING_URL="${HC_VERIFY_PING_URL:-}"   # a SEPARATE healthchecks check from the backup one

# Core data tables: checksum-compared restored-vs-live.
CORE_TABLES="recipes feedback beans preferences grinders drippers app_users user_identities user_gear grinder_calibration saved_recipes saved_beans"
# Sentinel tables: count-compared restored-vs-live (catches anything outside CORE).
SENTINEL_TABLES="bean_photos bean_purchase_links bd_migration_meta pgmigrations"

log()  { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
hc()   { [ -n "$HC_PING_URL" ] || return 0; curl -fsS -m 10 --retry 3 "${HC_PING_URL}${1:+/$1}" -o /dev/null || true; }

fails=0
note_fail() { fails=$((fails + 1)); log "  ✗ MISMATCH: $*"; }

FRESH_DUMP=""
drop_db() { sudo -n -u postgres psql -v ON_ERROR_STOP=1 -tAc "DROP DATABASE IF EXISTS \"$VERIFY_DB\";" postgres >/dev/null 2>&1 || true; }
cleanup() { drop_db; [ -n "$FRESH_DUMP" ] && rm -f "$FRESH_DUMP"; return 0; }
on_err()  { log "VERIFY ERRORED (line $1)"; hc fail; cleanup; }
trap 'on_err "$LINENO"' ERR
trap 'cleanup' EXIT

hc start

DATABASE_URL="$(grep -E '^DATABASE_URL=' "$API_ENV" | cut -d= -f2-)"
: "${DATABASE_URL:?DATABASE_URL not found in $API_ENV}"

# scalar query helpers
q_live()   { psql -v ON_ERROR_STOP=1 -tAc "$1" "$DATABASE_URL"; }
q_verify() { sudo -n -u postgres psql -v ON_ERROR_STOP=1 -tAc "$1" "$VERIFY_DB"; }

# Order-independent, key-agnostic table fingerprint: count + hash of sorted per-row hashes.
# Safe to include timestamps (set_updated_at is BEFORE UPDATE only) on a same-version round-trip.
fp_sql() { printf "SELECT count(*)||'|'||coalesce(md5(string_agg(md5(t::text), '' ORDER BY md5(t::text))),'EMPTY') FROM %s t;" "$1"; }

# --- pick the dump to verify ---
if [ -n "${1:-}" ]; then
  DUMP="$1"; MODE="stored artifact"
else
  FRESH_DUMP="$(mktemp /tmp/brewdial-verify-XXXXXX.dump)"
  log "taking a fresh consistent dump for verification"
  pg_dump -Fc "$DATABASE_URL" > "$FRESH_DUMP"
  chmod 0644 "$FRESH_DUMP"   # the postgres user runs pg_restore and must read it
  DUMP="$FRESH_DUMP"; MODE="fresh dump"
fi
[ -r "$DUMP" ] || { log "dump not readable: $DUMP"; hc fail; exit 1; }
log "verify mode: $MODE  source: $DUMP"
pg_restore -l "$DUMP" > /dev/null   # TOC must be readable, else the archive is corrupt

# --- restore into a throwaway DB ---
drop_db
sudo -n -u postgres psql -v ON_ERROR_STOP=1 -tAc "CREATE DATABASE \"$VERIFY_DB\";" postgres >/dev/null
log "restoring into $VERIFY_DB ..."
sudo -n -u postgres pg_restore --no-owner --no-privileges --exit-on-error -d "$VERIFY_DB" "$DUMP"
log "restore OK"

# --- 1. core tables: count + content checksum, restored vs live ---
for tbl in $CORE_TABLES; do
  live="$(q_live "$(fp_sql "$tbl")")"
  ver="$(q_verify "$(fp_sql "$tbl")")"
  if [ "$live" = "$ver" ]; then log "  ✓ $tbl  ($live)"; else note_fail "$tbl  live=[$live] restored=[$ver]"; fi
done

# --- 2. sentinel tables: row count restored vs live ---
for tbl in $SENTINEL_TABLES; do
  live="$(q_live "SELECT count(*) FROM $tbl;")"
  ver="$(q_verify "SELECT count(*) FROM $tbl;")"
  if [ "$live" = "$ver" ]; then log "  ✓ sentinel $tbl=$ver"; else note_fail "sentinel $tbl live=$live restored=$ver"; fi
done

# --- 3. recipe_code_seq: must survive AND stay ahead of the max existing code ---
live_seq="$(q_live   "SELECT last_value FROM recipe_code_seq;")"
ver_seq="$(q_verify  "SELECT last_value FROM recipe_code_seq;")"
max_code="$(q_verify "SELECT coalesce(max(nullif(regexp_replace(code,'\\D','','g'),'')::int),0) FROM recipes;")"
[ "$live_seq" = "$ver_seq" ] && log "  ✓ recipe_code_seq=$ver_seq" || note_fail "recipe_code_seq live=$live_seq restored=$ver_seq"
[ "$ver_seq" -ge "$max_code" ] && log "  ✓ seq($ver_seq) >= max code suffix($max_code)" || note_fail "recipe_code_seq $ver_seq < max code $max_code (next code would COLLIDE)"

# --- verdict ---
recipes_live="$(q_live "SELECT count(*) FROM recipes;")"
log "----"
log "recipes(live)=$recipes_live   mismatches=$fails"
if [ "$fails" -eq 0 ]; then
  log "GATE PASS ✅  (restored copy is byte-faithful to live brewdial)"
  hc
else
  log "GATE FAIL ❌  ($fails mismatch(es) — DO NOT decommission Supabase)"
  hc fail
  exit 1
fi
