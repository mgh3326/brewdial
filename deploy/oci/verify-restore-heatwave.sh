#!/usr/bin/env bash
# BrewDial restore verification for HeatWave. Restores a dump into a throwaway
# MySQL container with no network and compares every table with the live schema:
# row count and a whole-row checksum. It also requires recipe_code_seq to stay
# ahead of the highest COF- code. Any mismatch exits non-zero and pings /fail.
#
#   verify-restore-heatwave.sh             # take a fresh consistent dump, restore, compare
#   verify-restore-heatwave.sh <dump.sql.gz>  # a stored artifact; rows written since then show as mismatches
#
# Run weekly by brewdial-verify.timer. A write between the dump and the compare
# also shows as a mismatch: rerun once before you treat it as a failure.
set -Eeuo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=heatwave-client.sh
. "$here/heatwave-client.sh"

CONFIG="${BREWDIAL_BACKUP_ENV:-/etc/brewdial/backup.env}"
# shellcheck source=/dev/null
[ -r "$CONFIG" ] && . "$CONFIG"

HEATWAVE_ENV="${HEATWAVE_ENV:-/etc/brewdial/heatwave.env}"
HC_PING_URL="${HC_VERIFY_PING_URL:-}"   # a SEPARATE healthchecks check from the backup one
RESTORE_DB=brewdial_verify
CONTAINER="brewdial-verify-$$"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
hc() { [ -n "$HC_PING_URL" ] || return 0; curl -fsS -m 10 --retry 3 "${HC_PING_URL}${1:+/$1}" -o /dev/null || true; }

fails=0
note_fail() { fails=$((fails + 1)); log "  MISMATCH: $*"; }

FRESH_DUMP=""
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  [ -z "$FRESH_DUMP" ] || rm -f "$FRESH_DUMP"
  heatwave_unload
}
trap 'log "VERIFY ERRORED (line $LINENO)"; hc fail' ERR
trap cleanup EXIT

hc start

[ -r "$HEATWAVE_ENV" ] || { log "$HEATWAVE_ENV is not readable"; false; }
heatwave_load "$HEATWAVE_ENV"

q_live() { heatwave_client mysql -N -B "$HEATWAVE_DB" -e "$1"; }
q_restored() { docker exec -i "$CONTAINER" mysql -uroot --default-character-set=utf8mb4 -N -B "$RESTORE_DB" -e "$1"; }

if [ -n "${1:-}" ]; then
  DUMP="$1"
  log "verify mode: stored artifact $DUMP"
else
  FRESH_DUMP="$(mktemp "${TMPDIR:-/tmp}/brewdial-verify-XXXXXX.sql.gz")"
  log "verify mode: fresh dump"
  heatwave_dump | gzip >"$FRESH_DUMP"
  DUMP="$FRESH_DUMP"
fi
heatwave_check_dump "$DUMP"

# The empty root password is reachable only through docker exec: --network none.
docker run -d --rm --name "$CONTAINER" --network none --memory=1g --tmpfs /var/lib/mysql \
  -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE="$RESTORE_DB" \
  "$MYSQL_CLIENT_IMAGE" --skip-log-bin --character-set-server=utf8mb4 >/dev/null
ready=0
# TCP answers only on the final server, not on the image's temporary init server.
for _ in $(seq 1 120); do
  if docker exec "$CONTAINER" mysql -uroot --protocol=tcp -h127.0.0.1 -N -e 'select 1' "$RESTORE_DB" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[ "$ready" = 1 ] || { log "throwaway MySQL did not start"; false; }

log "restoring into $RESTORE_DB ..."
gzip -dc "$DUMP" | docker exec -i "$CONTAINER" mysql -uroot --default-character-set=utf8mb4 "$RESTORE_DB"
log "restore OK"

tables="$(q_live "select table_name from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE' order by table_name")"
[ -n "$tables" ] || { log "the live schema has no tables"; false; }
for table in $tables; do
  columns="$(q_live "set session group_concat_max_len = 1000000; select group_concat(concat('\`', column_name, '\`') order by ordinal_position) from information_schema.columns where table_schema = database() and table_name = '$table'")"
  sql="select concat(count(*), '|', coalesce(bit_xor(cast(conv(substr(md5(json_array($columns)), 1, 16), 16, 10) as unsigned)), 0)) from \`$table\`"
  live="$(q_live "$sql")"
  restored="$(q_restored "$sql")"
  if [ "$live" = "$restored" ]; then log "  ok $table ($live)"; else note_fail "$table live=[$live] restored=[$restored]"; fi
done

# Every API write path relies on these. A dump user without the TRIGGER grant
# silently drops the triggers from the dump and from its own view of the live schema.
for kind in triggers views; do
  column=trigger_schema
  [ "$kind" = views ] && column=table_schema
  restored="$(q_restored "select count(*) from information_schema.$kind where $column = database()")"
  if [ "$restored" -gt 0 ]; then log "  ok $kind=$restored"; else note_fail "the restored schema has no $kind"; fi
done

seq_value="$(q_restored 'select value from recipe_code_seq where id = 1')"
max_code="$(q_restored "select coalesce(max(cast(substr(code, 5) as unsigned)), 0) from recipes where code regexp '^COF-[0-9]+$'")"
if [ "$seq_value" -ge "$max_code" ]; then
  log "  ok recipe_code_seq=$seq_value >= highest code $max_code"
else
  note_fail "recipe_code_seq $seq_value < highest code $max_code (the next code would collide)"
fi

log "----"
if [ "$fails" -eq 0 ]; then
  log "GATE PASS: the restored copy matches live HeatWave"
  hc
else
  log "GATE FAIL: $fails mismatch(es)"
  hc fail
  exit 1
fi
