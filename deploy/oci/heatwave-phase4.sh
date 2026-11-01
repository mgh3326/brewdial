#!/usr/bin/env bash
# Phase 4 of docs/runbooks/oci-heatwave-cutover.md: a short planned maintenance
# window. Nothing runs against a database while it is copied. The desk runs this on
# the host with sudo. It stops at the first failed check, and it never switches
# public traffic: it prints the cloudflared command instead.
#
#   heatwave-phase4.sh cutover  --digest sha256:<64 hex> [--preflight] [--replace-target] [--accept-order]
#   heatwave-phase4.sh rollback --digest sha256:<64 hex> [--preflight]
#
# cutover:  save the Node API's read responses -> stop the Node API -> copy
#           PostgreSQL to MySQL -> verify -> start api-kt on MySQL -> compare it
#           with the saved responses -> print the cloudflared switch.
# rollback: stop api-kt. If a cutover finished and MySQL differs from PostgreSQL,
#           dump PostgreSQL, copy MySQL over it and verify. Then start the Node API.
#
# Credentials stay in the env files. docker receives only their paths, and the
# tool output goes to a root-only log. The terminal shows the report lines only.
set -Eeuo pipefail
umask 077

ENV_DIR="${PHASE4_ENV_DIR:-/etc/shiftgate}"
COPY_ENV="$ENV_DIR/brewdial-copy.env"
ROLLBACK_ENV="$ENV_DIR/brewdial-rollback.env"
KT_ENV="$ENV_DIR/brewdial-api-kt.env"
STATE_DIR="${PHASE4_STATE_DIR:-/var/lib/brewdial}"
# Exists from a finished cutover until its rollback. It holds the digest it used.
CUTOVER_MARKER="$STATE_DIR/phase4-cutover-done"
BACKUP_DIR="${PHASE4_BACKUP_DIR:-/var/backups/brewdial/final-postgres}"
LOG_DIR="${PHASE4_LOG_DIR:-/var/log/brewdial-phase4}"
FIXTURES="$LOG_DIR/fixtures"
NODE_START_TIMEOUT="${PHASE4_NODE_START_TIMEOUT:-90}"
CLOUDFLARED_CONFIG=/etc/cloudflared/config.yml
NODE_URL="http://127.0.0.1:8020"
KT_URL="http://127.0.0.1:8021"
IMAGE="ghcr.io/mgh3326/brewdial-api-kt"
KT_SERVICE="brewdial-api-kt"
NODE_SERVICE="brewdial-api"

STEP="arguments"
RECOVERY=""
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TOOL_LOG=""
TOOL_STATUS=0

# Removes the credentials from a connection URL and from key=value pairs.
redact() {
  sed -uE \
    -e 's#([A-Za-z][A-Za-z0-9+.-]*://)[^/@[:space:]]+@#\1***@#g' \
    -e 's#((password|passwd|pwd)[=:][[:space:]]*)[^[:space:]&]+#\1***#Ig'
}

# Every line of this script's output passes through redact.
exec 3>&1 4>&2
exec > >(redact >&3) 2>&1
REDACT_PID=$!
finish() {
  exec 1>&3 2>&4
  wait "$REDACT_PID" 2>/dev/null || true
}
trap finish EXIT
trap 'fail "unexpected error on line $LINENO"' ERR

log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

fail() {
  trap - ERR
  printf 'PHASE4_FAILED step=%s: %s\n' "$STEP" "$*"
  [ -z "$RECOVERY" ] || printf 'Next: %s\n' "$RECOVERY"
  exit 1
}

step() {
  STEP="$1"
  log "== $1: $2"
}

usage() {
  grep -E '^#   heatwave-phase4.sh ' "$0" | sed 's/^# *//' >&2
  exit 2
}

http_code() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$@" || true; }

node_answers() { [ "$(http_code "$NODE_URL/api/db/health")" = 200 ]; }

# One read of the shiftgate state of a service: jq filter on its status entry.
shiftgate_state() {
  shiftgate status --json | jq -r --arg name "$1" ".[] | select(.name == \$name) | $2"
}

check_env_file() {
  local file="$1" mode pattern
  shift
  [ -r "$file" ] || fail "$file is missing"
  mode="$(stat -c '%a' "$file")"
  [ "$mode" = 600 ] || fail "$file has mode $mode, expected 600"
  for pattern in "$@"; do
    [ "$(grep -cE "$pattern" "$file" || true)" = 1 ] || fail "$file needs exactly one line matching $pattern"
  done
}

check_tools() {
  local tool
  for tool in docker shiftgate curl jq sudo pg_restore flock; do
    command -v "$tool" >/dev/null || fail "$tool is not installed"
  done
  [ "$(id -u)" = 0 ] || fail "run this with sudo"
}

check_digest() {
  [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "--digest must be sha256:<64 hex>"
}

check_copy_env_files() {
  check_env_file "$COPY_ENV" '^DATABASE_URL=' '^BREWDIAL_COPY_SOURCE_URL=' '^DATABASE_URL=mysql://' '^BREWDIAL_COPY_SOURCE_URL=postgres(ql)?://'
  check_env_file "$ROLLBACK_ENV" '^DATABASE_URL=' '^BREWDIAL_COPY_SOURCE_URL=' '^DATABASE_URL=postgres(ql)?://' '^BREWDIAL_COPY_SOURCE_URL=mysql://'
}

# A second run would change the state this one is relying on.
take_lock() {
  install -d -m 0700 "$LOG_DIR"
  exec 9>"$LOG_DIR/phase4.lock"
  flock -n 9 || fail "another heatwave-phase4.sh is running"
}

# Every colour of a service, by shiftgate's container name, if it exists.
service_containers() {
  local names color
  names="$(docker ps -a --format '{{.Names}}')"
  for color in blue green; do
    if grep -qx "shiftgate-$1-$color" <<<"$names"; then echo "shiftgate-$1-$color"; fi
  done
}

check_service_stopped() {
  local name
  for name in $(service_containers "$1"); do
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = false ] \
      || fail "$name is running; is a Dagu job (shiftgate follow or check --heal) still active?"
  done
}

# A stop waits for requests to finish, and a stopped process cannot write.
stop_service() {
  local name
  for name in $(service_containers "$1"); do
    docker stop -t 40 "$name" >/dev/null 2>&1 || true
    echo "stopped $name"
  done
  check_service_stopped "$1"
}

start_node() {
  local color deadline=$((SECONDS + NODE_START_TIMEOUT))
  color="$(shiftgate_state "$NODE_SERVICE" '.state.active.color // "none"')"
  docker start "shiftgate-$NODE_SERVICE-$color" >/dev/null || fail "cannot start shiftgate-$NODE_SERVICE-$color"
  until node_answers; do
    [ "$SECONDS" -lt "$deadline" ] || fail "the Node API did not answer within ${NODE_START_TIMEOUT}s"
    sleep 1
  done
}

# Runs the copy tool and shows only its report lines. Sets TOOL_LOG and TOOL_STATUS.
run_tool() {
  local label="$1" env_file="$2" mode="$3"
  TOOL_LOG="$LOG_DIR/$STAMP-$label.log"
  TOOL_STATUS=0
  docker run --rm --network host --env-file "$env_file" \
    -e SPRING_MAIN_WEB_APPLICATION_TYPE=none -e BREWDIAL_COPY_MODE="$mode" \
    "$IMAGE@$DIGEST" 2>&1 | redact >"$TOOL_LOG" || TOOL_STATUS=$?
  grep -E '^(TABLE|SEQUENCE)	|^[a-z_]+	[0-9]+	[0-9]+	([0-9a-f]{64}	[0-9a-f]{64}	)?(OK|MISMATCH)$|^COPY_(VERIFY_OK|VERIFY_MISMATCH|CHECK_FAILED|FAILED|ROLLED_BACK)' "$TOOL_LOG" || true
}

run_copy_tool() {
  run_tool "$@"
  [ "$TOOL_STATUS" = 0 ] || fail "$1 exited with status $TOOL_STATUS (log: $TOOL_LOG)"
  grep -q '^COPY_VERIFY_OK ' "$TOOL_LOG" || fail "$1 did not report COPY_VERIFY_OK (log: $TOOL_LOG)"
}

# The differences the README allows between the two runtimes: timestamp precision
# (Node keeps milliseconds) and numeric JSON types (Node sends int8 as strings).
PARITY_FILTER='
  def ts: capture("^(?<head>\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(\\.(?<frac>\\d+))?(Z|\\+00:?00)$")
    | "\(.head).\(((.frac // "") + "000")[0:3])Z";
  walk(
    if type == "string" then
      if test("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|\\+00:?00)$") then ts
      elif test("^-?\\d+(\\.\\d+)?$") then tonumber
      else . end
    else . end)'

fetch_normalised() {
  curl -fsS -m 20 "$1" | jq -S "$PARITY_FILTER"
}

# The lists that sort by a value the two databases can order differently: names
# by collation, and continuum_position by where NULL goes (runbook 4.3).
order_may_differ() {
  case "$1" in
    /api/beans | /api/grinders | /api/drippers) return 0 ;;
    *) return 1 ;;
  esac
}

# Rows with one created_at have no defined order on either database. Every other
# position must still agree, so a list sorted the wrong way does not pass.
differs_only_in_ties() {
  case "$1" in
    '/api/recipes?'*) ;;
    *) return 1 ;;
  esac
  same_when_sorted "$2" "$3" && [ "$(jq -c 'map(.created_at)' "$2")" = "$(jq -c 'map(.created_at)' "$3")" ]
}

# Sorts the endpoint's own list only. Arrays inside a row keep their order.
same_when_sorted() {
  local sort_list='if type == "array" then sort else . end'
  [ "$(jq -S "$sort_list" "$1")" = "$(jq -S "$sort_list" "$2")" ]
}

# Saves what the Node API answers now, while it still runs, for the parity step.
save_fixtures() {
  local path bean code index=0
  rm -rf "$FIXTURES"
  install -d -m 0700 "$FIXTURES"
  bean="$(curl -fsS -m 20 "$NODE_URL/api/beans" | jq -r '.[0].id // empty')" || fail "the Node API did not answer /api/beans"
  code="$(curl -fsS -m 20 "$NODE_URL/api/recipes?limit=1" | jq -r '.[0].code // empty')" || fail "the Node API did not answer /api/recipes"
  for path in /api/beans '/api/recipes?limit=100' /api/grinders /api/drippers \
    ${bean:+"/api/beans/$bean" "/api/beans/$bean/purchase-links" "/api/recipes?beanId=$bean"} \
    ${code:+"/api/recipes/$code" "/api/recipes/$code/feedback"}; do
    index=$((index + 1))
    fetch_normalised "$NODE_URL$path" >"$FIXTURES/$index.json" || fail "the Node API did not answer $path"
    printf '%s\t%s\n' "$index" "$path" >>"$FIXTURES/paths.tsv.partial"
  done
  mv "$FIXTURES/paths.tsv.partial" "$FIXTURES/paths.tsv"
  log "saved $index responses"
}

compare_with_fixtures() {
  local index path fixture kt_out
  while IFS=$'\t' read -r index path; do
    fixture="$FIXTURES/$index.json"
    kt_out="$(mktemp -p "$LOG_DIR")"
    fetch_normalised "$KT_URL$path" >"$kt_out" || fail "api-kt did not answer $path"
    if cmp -s "$fixture" "$kt_out"; then
      log "same: $path"
    elif [ "$ACCEPT_ORDER" = 1 ] && order_may_differ "$path" && same_when_sorted "$fixture" "$kt_out"; then
      log "same apart from order (--accept-order): $path"
    elif [ "$ACCEPT_ORDER" = 1 ] && differs_only_in_ties "$path" "$fixture" "$kt_out"; then
      log "same apart from rows with equal created_at (--accept-order): $path"
    else
      diff -u "$fixture" "$kt_out" | head -40 || true
      fail "parity: api-kt on MySQL differs from what the Node API answered for $path"
    fi
    rm -f "$kt_out"
  done <"$FIXTURES/paths.tsv"
}

cutover() {
  step preflight "read-only checks"
  check_tools
  check_digest
  take_lock
  check_copy_env_files
  check_env_file "$KT_ENV" '^DATABASE_URL=mysql://'
  # MySQL may hold the newest data, and a new copy would overwrite it.
  [ ! -e "$CUTOVER_MARKER" ] || fail "a finished cutover still stands, so MySQL may hold the newest data: run rollback first"
  [ "$(shiftgate_state "$NODE_SERVICE" '.state.active.color // "none"')" != none ] || fail "$NODE_SERVICE has no active colour to return to"
  local save=1
  if ! node_answers; then
    [ -s "$FIXTURES/paths.tsv" ] || fail "the Node API does not answer, and no saved responses exist from an earlier run"
    save=0
    log "the Node API is down and saved responses exist: treating this as a retry"
  fi
  if [ "$PREFLIGHT" = 1 ]; then
    log "PHASE4_PREFLIGHT_OK cutover (nothing was changed)"
    return 0
  fi

  step save "the Node API's read responses, for the parity step"
  if [ "$save" = 1 ]; then save_fixtures; else log "keeping the responses from the earlier run"; fi

  RECOVERY="To end the window, run: heatwave-phase4.sh rollback --digest $DIGEST. It restarts the Node API on the untouched PostgreSQL. To retry instead, add --replace-target if MySQL already holds rows."
  step stop "stop the Node API and any api-kt: no writers from here on"
  stop_service "$NODE_SERVICE"
  stop_service "$KT_SERVICE"
  if node_answers; then fail "$NODE_URL still answers with the Node API stopped: something else is serving it"; fi

  step copy "PostgreSQL to MySQL, then counts, checksums and sequence"
  run_copy_tool copy "$COPY_ENV" "$COPY_MODE"

  step verify "fresh snapshot of both databases"
  run_copy_tool verify "$COPY_ENV" verify

  step start "api-kt on MySQL"
  shiftgate deploy "$KT_SERVICE" --digest "$DIGEST" || fail "shiftgate deploy failed"
  [ "$(shiftgate_state "$KT_SERVICE" '.state.active.digest // "none"')" = "$DIGEST" ] || fail "$KT_SERVICE is not active on --digest"
  [ "$(http_code "$KT_URL/api/db/health")" = 200 ] || fail "api-kt on MySQL is not healthy at $KT_URL/api/db/health"

  step parity "api-kt on MySQL against the saved Node API responses"
  compare_with_fixtures

  step finish "nothing restarted the Node API during the window"
  check_service_stopped "$NODE_SERVICE"
  printf '%s\n' "$DIGEST" >"$CUTOVER_MARKER"
  RECOVERY=""
  log "PHASE4_READY: the Node API is stopped and api-kt is ready. Reports: $LOG_DIR/$STAMP-*.log"
  cat <<EOF
Switch public traffic yourself with:

  sudo sed -i 's#$NODE_URL#$KT_URL#' $CLOUDFLARED_CONFIG && sudo systemctl restart cloudflared
EOF
}

rollback() {
  step preflight "read-only checks"
  check_tools
  check_digest
  take_lock
  check_copy_env_files
  [ "$(shiftgate_state "$NODE_SERVICE" '.state.active.color // "none"')" != none ] || fail "$NODE_SERVICE has no active colour to return to"
  if [ -e "$CUTOVER_MARKER" ] && [ "$(cat "$CUTOVER_MARKER")" != "$DIGEST" ]; then
    fail "the cutover ran with another image; pass the digest it was run with"
  fi
  if [ "$PREFLIGHT" = 1 ]; then
    log "PHASE4_PREFLIGHT_OK rollback (nothing was changed)"
    return 0
  fi

  RECOVERY="PostgreSQL keeps its rows unless the replace reported COPY_VERIFY_OK. The Node API stays stopped; fix the cause and run rollback again."
  step stop "stop api-kt and the Node API: no writers from here on"
  stop_service "$KT_SERVICE"
  stop_service "$NODE_SERVICE"

  if [ -e "$CUTOVER_MARKER" ]; then
    step compare "did MySQL take any writes?"
    run_tool compare "$COPY_ENV" verify
    if grep -q '^COPY_VERIFY_OK ' "$TOOL_LOG" && [ "$TOOL_STATUS" = 0 ]; then
      log "MySQL took no writes: PostgreSQL is current, and nothing is copied"
    elif grep -q '^COPY_VERIFY_MISMATCH' "$TOOL_LOG"; then
      step safety-dump "PostgreSQL as it is now, before the replace"
      install -d -m 0750 "$BACKUP_DIR"
      local dump="$BACKUP_DIR/pre-rollback-$STAMP.dump"
      # The redirect runs as root on purpose: only root may read the safety dump.
      # shellcheck disable=SC2024
      sudo -u postgres pg_dump -Fc brewdial >"$dump" || fail "pg_dump failed"
      pg_restore -l "$dump" >/dev/null || fail "$dump is not a readable archive"
      log "dump OK: $dump"

      step replace "MySQL to PostgreSQL: full replace, then counts, checksums and sequence"
      run_copy_tool rollback-replace "$ROLLBACK_ENV" replace

      step verify "fresh snapshot of both databases"
      run_copy_tool rollback-verify "$ROLLBACK_ENV" verify
    else
      fail "the comparison did not finish (log: $TOOL_LOG)"
    fi
    # PostgreSQL is current. A second rollback must not overwrite what it takes next.
    rm -f "$CUTOVER_MARKER"
  else
    log "no finished cutover: MySQL never served, and PostgreSQL is untouched"
  fi

  step start "the Node API on PostgreSQL"
  start_node
  RECOVERY=""
  log "PHASE4_ROLLBACK_READY: the Node API answers on $NODE_URL. Reports: $LOG_DIR/$STAMP-*.log"
  cat <<EOF
If cloudflared points at api-kt, switch public traffic back yourself with:

  sudo sed -i 's#$KT_URL#$NODE_URL#' $CLOUDFLARED_CONFIG && sudo systemctl restart cloudflared
EOF
}

COMMAND="${1:-}"
[ $# -eq 0 ] || shift
DIGEST=""
PREFLIGHT=0
COPY_MODE=copy
ACCEPT_ORDER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --digest)
      [ $# -ge 2 ] || usage
      DIGEST="$2"
      shift 2
      ;;
    --preflight)
      PREFLIGHT=1
      shift
      ;;
    --replace-target)
      COPY_MODE=replace
      shift
      ;;
    --accept-order)
      ACCEPT_ORDER=1
      shift
      ;;
    *) usage ;;
  esac
done

case "$COMMAND" in
  cutover) cutover ;;
  rollback) rollback ;;
  *) usage ;;
esac
