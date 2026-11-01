#!/usr/bin/env bash
# Phase 4 of docs/runbooks/oci-heatwave-cutover.md as one command sequence. The
# desk runs it on the host with sudo. It stops at the first failed check, and it
# never switches public traffic: it prints the cloudflared command instead.
#
#   heatwave-phase4.sh cutover  --digest sha256:<64 hex> [--preflight] [--replace-target] [--accept-order]
#   heatwave-phase4.sh rollback --digest sha256:<64 hex> [--preflight]
#   heatwave-phase4.sh unfreeze
#
# cutover:  freeze writes -> copy PostgreSQL to MySQL -> verify -> deploy api-kt
#           green on MySQL -> parity against the live Node API -> verify again ->
#           print the cloudflared switch.
# rollback: dump PostgreSQL -> copy MySQL to PostgreSQL (full replace) -> verify ->
#           print the choices. Writes stay frozen until the desk runs `unfreeze`.
#           Refused unless a cutover verified and nothing has ended it since.
#
# Credentials stay in the env files. docker receives only their paths, and the
# tool output goes to a root-only log. The terminal shows the report lines only.
set -Eeuo pipefail
umask 077

ENV_DIR="${PHASE4_ENV_DIR:-/etc/shiftgate}"
COPY_ENV="$ENV_DIR/brewdial-copy.env"
ROLLBACK_ENV="$ENV_DIR/brewdial-rollback.env"
KT_ENV="$ENV_DIR/brewdial-api-kt.env"
FREEZE_FILE="${PHASE4_FREEZE_FILE:-/var/lib/brewdial/freeze/write-freeze}"
CLOUDFLARED_CONFIG="${PHASE4_CLOUDFLARED_CONFIG:-/etc/cloudflared/config.yml}"
# Exists only between a verified cutover and its rollback, unfreeze or next window.
CUTOVER_MARKER="$FREEZE_FILE.cutover-verified"
BACKUP_DIR="${PHASE4_BACKUP_DIR:-/var/backups/brewdial/final-postgres}"
LOG_DIR="${PHASE4_LOG_DIR:-/var/log/brewdial-phase4}"
DRAIN_SECONDS="${PHASE4_DRAIN_SECONDS:-5}"
NODE_PORT=8020
KT_PORT=8021
NODE_URL="http://127.0.0.1:$NODE_PORT"
KT_URL="http://127.0.0.1:$KT_PORT"
IMAGE="ghcr.io/mgh3326/brewdial-api-kt"
KT_SERVICE="brewdial-api-kt"
PROBE_PATH="/api/write-freeze-probe"

STEP="arguments"
RECOVERY=""
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

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

expect_healthy() {
  [ "$(http_code "$2/api/db/health")" = 200 ] || fail "$1 is not healthy at $2/api/db/health"
}

# One read of the shiftgate state of a service: jq filter on its status entry.
shiftgate_state() {
  shiftgate status --json | jq -r --arg name "$1" ".[] | select(.name == \$name) | $2"
}

check_env_file() {
  local file="$1" mode
  shift
  [ -r "$file" ] || fail "$file is missing"
  mode="$(stat -c '%a' "$file")"
  [ "$mode" = 600 ] || fail "$file has mode $mode, expected 600"
  local pattern
  for pattern in "$@"; do
    [ "$(grep -cE "$pattern" "$file" || true)" = 1 ] || fail "$file needs exactly one line matching $pattern"
  done
}

# The service cloudflared itself resolves for a URL, from the file it loads.
cloudflared_service() {
  cloudflared tunnel --config "$CLOUDFLARED_CONFIG" ingress rule "$1" 2>/dev/null \
    | sed -n 's/^[[:space:]]*service:[[:space:]]*//p' | head -n 1 || true
}

# Public traffic must reach the Node API and nothing may reach api-kt. Text in the
# file proves neither, so cloudflared resolves every host in an active rule and the
# catch-all, and the running process must have loaded this version of the file.
check_cloudflared_on_node() {
  local active host path service on_node=0 started
  [ -r "$CLOUDFLARED_CONFIG" ] || fail "$CLOUDFLARED_CONFIG is missing"
  command -v cloudflared >/dev/null || fail "cloudflared is not installed"

  active="$(sed -E 's/(^|[[:space:]])#.*$//' "$CLOUDFLARED_CONFIG")"
  # Also covers a rule limited by path, which resolving a URL could miss.
  if grep -qE "service:.*:$KT_PORT([/[:space:]\"']|\$)" <<<"$active"; then
    fail "an active cloudflared rule points at api-kt (:$KT_PORT); point it at $NODE_URL first"
  fi
  for host in $(sed -nE "s/^[[:space:]-]*hostname:[[:space:]]*[\"']?([^\"'[:space:]]+).*/\\1/p" <<<"$active") phase4-no-such-host.invalid; do
    host="${host/#\*./phase4.}"
    for path in / /api/health; do
      service="$(cloudflared_service "https://$host$path")"
      [ -n "$service" ] || fail "cloudflared resolved no rule for $host$path (is $CLOUDFLARED_CONFIG valid?)"
      case "$service" in
        *:"$KT_PORT" | *:"$KT_PORT"/*) fail "cloudflared sends $host$path to api-kt ($service); point it at $NODE_URL first" ;;
        *:"$NODE_PORT" | *:"$NODE_PORT"/*) on_node=1 ;;
      esac
    done
  done
  [ "$on_node" = 1 ] || fail "no cloudflared rule sends traffic to the Node API ($NODE_URL)"

  systemctl is-active --quiet cloudflared || fail "cloudflared is not running"
  started="$(systemctl show cloudflared --property=ActiveEnterTimestamp --value)"
  started="$(date -d "$started" +%s 2>/dev/null)" || fail "cannot read when cloudflared started"
  [ "$started" -ge "$(stat -c %Y "$CLOUDFLARED_CONFIG")" ] \
    || fail "$CLOUDFLARED_CONFIG changed after cloudflared started: restart it, or it still routes by the old file"
}

check_tools() {
  local tool
  for tool in docker shiftgate curl jq sudo pg_restore; do
    command -v "$tool" >/dev/null || fail "$tool is not installed"
  done
  [ "$(id -u)" = 0 ] || fail "run this with sudo"
}

check_digest() {
  [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "--digest must be sha256:<64 hex>"
}

freeze_probe() { http_code -X POST "$NODE_URL$PROBE_PATH"; }

# Shows the report lines of a copy run and requires its success line.
run_copy_tool() {
  local label="$1" env_file="$2" mode="$3" log_file status=0
  log_file="$LOG_DIR/$STAMP-$label.log"
  docker run --rm --network host --env-file "$env_file" \
    -e SPRING_MAIN_WEB_APPLICATION_TYPE=none -e BREWDIAL_COPY_MODE="$mode" \
    "$IMAGE@$DIGEST" 2>&1 | redact >"$log_file" || status=$?
  grep -E '^(TABLE|SEQUENCE)	|^[a-z_]+	[0-9]+	[0-9]+	([0-9a-f]{64}	[0-9a-f]{64}	)?(OK|MISMATCH)$|^COPY_(VERIFY_OK|VERIFY_MISMATCH|CHECK_FAILED|FAILED)' "$log_file" || true
  [ "$status" = 0 ] || fail "$label exited with status $status (log: $log_file)"
  grep -q '^COPY_VERIFY_OK ' "$log_file" || fail "$label did not report COPY_VERIFY_OK (log: $log_file)"
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

# Sorts the endpoint's own list only. Arrays inside a row keep their order.
same_when_sorted() {
  local sort_list='if type == "array" then sort else . end'
  [ "$(jq -S "$sort_list" "$1")" = "$(jq -S "$sort_list" "$2")" ]
}

compare_path() {
  local path="$1" node_out kt_out
  node_out="$(mktemp -p "$LOG_DIR")"
  kt_out="$(mktemp -p "$LOG_DIR")"
  fetch_normalised "$NODE_URL$path" >"$node_out" || fail "Node API did not answer $path"
  fetch_normalised "$KT_URL$path" >"$kt_out" || fail "api-kt did not answer $path"
  if cmp -s "$node_out" "$kt_out"; then
    log "same: $path"
  elif [ "$ACCEPT_ORDER" = 1 ] && order_may_differ "$path" && same_when_sorted "$node_out" "$kt_out"; then
    log "same apart from order (--accept-order): $path"
  else
    diff -u "$node_out" "$kt_out" | head -40 || true
    fail "parity: $path differs between the Node API and api-kt"
  fi
  rm -f "$node_out" "$kt_out"
}

parity_precheck() {
  local path bean code
  for path in /api/beans '/api/recipes?limit=100' /api/grinders /api/drippers; do
    compare_path "$path"
  done
  bean="$(curl -fsS -m 20 "$NODE_URL/api/beans" | jq -r '.[0].id // empty')"
  if [ -n "$bean" ]; then
    compare_path "/api/beans/$bean"
    compare_path "/api/beans/$bean/purchase-links"
    compare_path "/api/recipes?beanId=$bean"
  fi
  code="$(curl -fsS -m 20 "$NODE_URL/api/recipes?limit=1" | jq -r '.[0].code // empty')"
  if [ -n "$code" ]; then
    compare_path "/api/recipes/$code"
    compare_path "/api/recipes/$code/feedback"
  fi
}

# api-kt reads the HeatWave URL from the copy env file. The PostgreSQL colour keeps
# the env it was created with, and the previous file stays beside the new one.
point_kt_env_at_mysql() {
  local tmp
  [ -e "$KT_ENV.postgres" ] || cp -p "$KT_ENV" "$KT_ENV.postgres"
  tmp="$(mktemp "$KT_ENV.XXXXXX")"
  { grep -v '^DATABASE_URL=' "$KT_ENV" || true; grep '^DATABASE_URL=' "$COPY_ENV"; } >"$tmp"
  chmod 0600 "$tmp"
  mv "$tmp" "$KT_ENV"
  [ "$(grep -c '^DATABASE_URL=mysql://' "$KT_ENV")" = 1 ] || fail "$KT_ENV has no MySQL DATABASE_URL"
}

cutover() {
  step preflight "read-only checks"
  check_tools
  check_digest
  check_env_file "$COPY_ENV" '^DATABASE_URL=' '^BREWDIAL_COPY_SOURCE_URL=' '^DATABASE_URL=mysql://' '^BREWDIAL_COPY_SOURCE_URL=postgres(ql)?://'
  check_env_file "$ROLLBACK_ENV" '^DATABASE_URL=' '^BREWDIAL_COPY_SOURCE_URL=' '^DATABASE_URL=postgres(ql)?://' '^BREWDIAL_COPY_SOURCE_URL=mysql://'
  check_env_file "$KT_ENV" '^DATABASE_URL='
  check_cloudflared_on_node
  [ -d "$(dirname "$FREEZE_FILE")" ] || fail "$(dirname "$FREEZE_FILE") is missing (runbook 4.1)"
  expect_healthy "Node API" "$NODE_URL"
  expect_healthy "api-kt on PostgreSQL" "$KT_URL"
  [ "$(shiftgate_state "$KT_SERVICE" '.state.active.color // "none"')" = blue ] \
    || fail "$KT_SERVICE must be active on blue (runbook 4.2 step 3)"
  [ "$(shiftgate_state "$KT_SERVICE" '.state.active.digest // "none"')" = "$DIGEST" ] \
    || fail "$KT_SERVICE blue must run --digest, so that the same image moves to MySQL"
  local probe
  probe="$(freeze_probe)"
  case "$probe" in
    404) ;;
    503) log "writes are already frozen (a repeated run)" ;;
    *) fail "the Node API has no write-freeze switch: probe answered $probe, expected 404 (runbook 4.1)" ;;
  esac
  install -d -m 0700 "$LOG_DIR"
  if [ "$PREFLIGHT" = 1 ]; then
    log "PHASE4_PREFLIGHT_OK cutover (nothing was changed)"
    return 0
  fi

  RECOVERY="to abort, run: shiftgate rollback $KT_SERVICE (only if green is active), then heatwave-phase4.sh unfreeze. Retry with --replace-target."
  step freeze "stop writes on the Node API"
  rm -f "$CUTOVER_MARKER"
  touch "$FREEZE_FILE"
  [ "$(freeze_probe)" = 503 ] || fail "the Node API does not honour $FREEZE_FILE (probe did not answer 503)"
  sleep "$DRAIN_SECONDS"

  step copy "PostgreSQL to MySQL, then counts, checksums and sequence"
  run_copy_tool copy "$COPY_ENV" "$COPY_MODE"

  step verify "fresh snapshot of both databases"
  run_copy_tool verify "$COPY_ENV" verify

  step deploy "api-kt green on MySQL"
  point_kt_env_at_mysql
  shiftgate deploy "$KT_SERVICE" --digest "$DIGEST" || fail "shiftgate deploy failed; the blue colour keeps serving"
  [ "$(shiftgate_state "$KT_SERVICE" '.state.active.color // "none"')" = green ] || fail "$KT_SERVICE is not active on green"
  [ "$(shiftgate_state "$KT_SERVICE" '.state.previous.color // "none"')" = blue ] || fail "$KT_SERVICE has no blue rollback colour"
  [ "$(shiftgate_state "$KT_SERVICE" '.state.rollback_available')" = true ] || fail "$KT_SERVICE rollback is not available"
  expect_healthy "api-kt on MySQL" "$KT_URL"

  step parity "live Node API against api-kt on MySQL"
  parity_precheck

  step final-verify "nothing wrote to either database during the window"
  run_copy_tool final-verify "$COPY_ENV" verify

  touch "$CUTOVER_MARKER"
  step "done" "ready to switch"
  log "PHASE4_READY: writes stay frozen until you switch traffic. Reports: $LOG_DIR/$STAMP-*.log"
  cat <<EOF
Switch public traffic yourself with:

  sudo sed -i 's#$NODE_URL#$KT_URL#' $CLOUDFLARED_CONFIG && sudo systemctl restart cloudflared

Keep the freeze file in place until the rollback window closes (runbook 4.5).
EOF
}

rollback() {
  step preflight "read-only checks"
  check_tools
  check_digest
  check_env_file "$ROLLBACK_ENV" '^DATABASE_URL=' '^BREWDIAL_COPY_SOURCE_URL=' '^DATABASE_URL=postgres(ql)?://' '^BREWDIAL_COPY_SOURCE_URL=mysql://'
  check_cloudflared_on_node
  [ "$(freeze_probe)" = 503 ] || fail "the Node API must stay frozen during the rollback copy: probe did not answer 503"
  [ -e "$CUTOVER_MARKER" ] || fail "no verified cutover to roll back: MySQL may be empty or stale, and this would replace PostgreSQL with it"
  install -d -m 0700 "$LOG_DIR"
  if [ "$PREFLIGHT" = 1 ]; then
    log "PHASE4_PREFLIGHT_OK rollback (nothing was changed)"
    return 0
  fi

  RECOVERY="PostgreSQL keeps its rows unless the replace reported COPY_VERIFY_OK. Writes stay frozen; fix the cause and run rollback again."
  step safety-dump "PostgreSQL as it is now, before the replace"
  install -d -m 0750 "$BACKUP_DIR"
  local dump="$BACKUP_DIR/pre-rollback-$STAMP.dump"
  # The redirect runs as root on purpose: only root may read the safety dump.
  # shellcheck disable=SC2024
  sudo -u postgres pg_dump -Fc brewdial >"$dump" || fail "pg_dump failed"
  pg_restore -l "$dump" >/dev/null || fail "$dump is not a readable archive"
  log "dump OK: $dump"

  step replace "MySQL to PostgreSQL: full replace, then counts, checksums and sequence"
  sleep "$DRAIN_SECONDS"
  run_copy_tool rollback-replace "$ROLLBACK_ENV" replace

  step verify "fresh snapshot of both databases"
  run_copy_tool rollback-verify "$ROLLBACK_ENV" verify

  # PostgreSQL may take writes from here on, so a second rollback must not overwrite them.
  rm -f "$CUTOVER_MARKER"
  step "done" "PostgreSQL holds the MySQL data"
  log "PHASE4_ROLLBACK_READY: writes stay frozen. Reports: $LOG_DIR/$STAMP-*.log"
  cat <<EOF
Choose one:

  Node API on PostgreSQL:   sudo $0 unfreeze
  api-kt on PostgreSQL:     sudo cp -p $KT_ENV.postgres $KT_ENV
                            sudo shiftgate rollback $KT_SERVICE
                            sudo sed -i 's#$NODE_URL#$KT_URL#' $CLOUDFLARED_CONFIG && sudo systemctl restart cloudflared
EOF
}

unfreeze() {
  step unfreeze "open writes on the Node API"
  [ "$(id -u)" = 0 ] || fail "run this with sudo"
  check_cloudflared_on_node
  # 503 is frozen, 404 is a repeated run. Anything else cannot prove writes reopened.
  local probe
  probe="$(freeze_probe)"
  case "$probe" in
    503 | 404) ;;
    *) fail "the Node API is not healthy (probe answered $probe); writes stay frozen and rollback stays available" ;;
  esac
  rm -f "$FREEZE_FILE"
  probe="$(freeze_probe)"
  if [ "$probe" != 404 ]; then
    touch "$FREEZE_FILE"
    [ "$(freeze_probe)" = 503 ] \
      || fail "probe answered $probe after the freeze was removed, and does not answer 503 now that it is back: writes may be open, so check the Node API before a rollback"
    fail "probe answered $probe, expected 404; the freeze is back, the probe answers 503, and rollback stays available"
  fi
  # PostgreSQL takes writes again, so MySQL is stale from here on.
  rm -f "$CUTOVER_MARKER"
  log "PHASE4_UNFROZEN"
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
  unfreeze) unfreeze ;;
  *) usage ;;
esac
