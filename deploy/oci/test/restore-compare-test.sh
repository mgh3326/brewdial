#!/usr/bin/env bash
# Runs compare_table (deploy/oci/restore-compare.sh), the code the restore gate runs,
# against two throwaway MySQL 8.4 containers: one stands in for live, one for the
# restored copy. Both start with --network none. Needs docker. With REQUIRE_DOCKER=1
# (set in CI) a missing docker fails the test instead of skipping it.
set -Eeuo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../heatwave-client.sh
. "$here/../heatwave-client.sh"
# shellcheck source=../restore-compare.sh
. "$here/../restore-compare.sh"

if ! docker info >/dev/null 2>&1; then
  if [ "${REQUIRE_DOCKER:-0}" = 1 ]; then
    echo "FAIL docker is required here and is not available"
    exit 1
  fi
  echo "SKIP docker is not available: the restore comparison test did not run"
  exit 0
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/restore-compare-test.XXXXXX")"
LIVE="rcmp-live-$$"
RESTORED="rcmp-restored-$$"
trap 'docker rm -f "$LIVE" "$RESTORED" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

failures=0
passed=0

# Only names and counts reach the output. The fixtures' values never do.
log() { printf '  %s\n' "$*"; }
note_fail() { printf '%s\n' "$*" >>"$work/mismatches"; }

q_live() { docker exec "$LIVE" mysql -uroot --default-character-set=utf8mb4 -N -B app -e "$1"; }
q_restored() { docker exec "$RESTORED" mysql -uroot --default-character-set=utf8mb4 -N -B app -e "$1"; }
restored_load() { docker exec -i "$RESTORED" mysql -uroot --default-character-set=utf8mb4 app; }
live_load() { docker exec -i "$LIVE" mysql -uroot --default-character-set=utf8mb4 app; }

start_server() {
  docker run -d --rm --name "$1" --network none --memory=1g --tmpfs /var/lib/mysql \
    -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE=app \
    "$MYSQL_CLIENT_IMAGE" --skip-log-bin --character-set-server=utf8mb4 >/dev/null
  for _ in $(seq 1 120); do
    if docker exec "$1" mysql -uroot --protocol=tcp -h127.0.0.1 -N -e 'select 1' app >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL $1 did not start" >&2
  exit 1
}

start_server "$LIVE"
start_server "$RESTORED"

# The schema is the same on both sides. Row values differ per case.
SCHEMA="drop table if exists items;
create table items (id varchar(36) not null primary key, label varchar(64) not null, payload json not null, note json);
drop table if exists plain;
create table plain (id int not null primary key, label varchar(64) not null);
insert into plain values (1, 'same');"

# case_setup <live item rows> <restored item rows>
case_setup() {
  printf '%s\n%s\n' "$SCHEMA" "$1" | live_load
  printf '%s\n%s\n' "$SCHEMA" "$2" | restored_load
  : >"$work/mismatches"
}

# check <name> <expected mismatches as one regex, each message ended by ;>
# NONE means the table must match. Messages are joined with ';' for the match.
check() {
  local name="$1" expected="$2" got=""
  if [ -s "$work/mismatches" ]; then got="$(tr '\n' ';' <"$work/mismatches")"; fi
  if [ "$expected" = NONE ]; then
    if [ -z "$got" ]; then
      printf 'ok   %s\n' "$name"; passed=$((passed + 1))
    else
      printf 'FAIL %s: unexpected mismatch(es)\n' "$name"; failures=$((failures + 1))
    fi
  elif [[ "$got" =~ ^$expected$ ]]; then
    printf 'ok   %s: %s\n' "$name" "$got"; passed=$((passed + 1))
  else
    printf 'FAIL %s: wanted [%s], got [%s]\n' "$name" "$expected" "$got"; failures=$((failures + 1))
  fi
}

# Case A: same JSON values, only the number text differs (1.0 on live, 1 on the restored
# copy). Must pass. The old whole-row checksum must see the difference, so the case is
# not vacuous.
case_setup \
  "insert into items values ('a', 'x', '{\"curve\": [[1.0, 2.5]]}', NULL);" \
  "insert into items values ('a', 'x', '{\"curve\": [[1, 2.5]]}', NULL);"
old_sql="select concat(count(*), '|', coalesce(bit_xor(cast(conv(substr(md5(json_array(\`id\`, \`label\`, \`payload\`, \`note\`)), 1, 16), 16, 10) as unsigned)), 0)) from \`items\`"
if [ "$(q_live "$old_sql")" = "$(q_restored "$old_sql")" ]; then
  printf 'FAIL case A is vacuous: the old whole-row checksum does not see the text difference\n'
  failures=$((failures + 1))
fi
compare_table items
compare_table plain
check "A formatting-only JSON difference passes" NONE

# Case B: one array element changed. Must fail and name items.payload, and nothing else.
case_setup \
  "insert into items values ('a', 'x', '{\"curve\": [[1.0, 2.5]]}', NULL);" \
  "insert into items values ('a', 'x', '{\"curve\": [[1, 3]]}', NULL);"
compare_table items
check "B changed JSON element fails, names table and column" \
  'items\.payload: 1 row\(s\) differ in JSON value;'

# Case C: a non-JSON column changed, JSON equal. Must fail through the whole-row checksum.
case_setup \
  "insert into items values ('a', 'x', '{\"curve\": [[1.0, 2.5]]}', NULL);" \
  "insert into items values ('a', 'y', '{\"curve\": [[1.0, 2.5]]}', NULL);"
compare_table items
check "C non-JSON change fails, names table" 'items live=\[[^]]*\] restored=\[[^]]*\];'

# Case D: a nullable JSON value present on live and NULL on the restored copy. A plain <>
# would give NULL here and let it pass; <=> must catch it.
case_setup \
  "insert into items values ('a', 'x', '{\"curve\": [[1.0, 2.5]]}', '[1]');" \
  "insert into items values ('a', 'x', '{\"curve\": [[1.0, 2.5]]}', NULL);"
compare_table items
check "D NULL-vs-value JSON fails, names column" 'items\.note: 1 row\(s\) differ in JSON value;'

# Case E: a live row missing from the restored copy. Must fail on count and on the row.
case_setup \
  "insert into items values ('a', 'x', '{\"curve\": [[1.0, 2.5]]}', NULL), ('b', 'z', '{\"curve\": []}', NULL);" \
  "insert into items values ('a', 'x', '{\"curve\": [[1.0, 2.5]]}', NULL);"
compare_table items
check "E missing live row fails" \
  'items live=\[[^]]*\] restored=\[[^]]*\];items: 1 live row\(s\) not found in the restored copy;'

if [ "$failures" -eq 0 ]; then
  printf 'PASS %s restore comparison cases\n' "$passed"
else
  printf 'FAIL %s restore comparison case(s)\n' "$failures"
  exit 1
fi
