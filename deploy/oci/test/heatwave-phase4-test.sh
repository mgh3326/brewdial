#!/usr/bin/env bash
# Drives deploy/oci/heatwave-phase4.sh against stub docker, shiftgate, curl and id
# commands. Each scenario fails one step and asserts that the script stops there,
# runs nothing after it, and prints no fixture secret. Every stub output that could
# carry a credential tries to leak the fixture password.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/../heatwave-phase4.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/phase4-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

SECRET="phase4-fixture-$$-value"
DIGEST="sha256:$(printf 'a%.0s' $(seq 1 64))"
OTHER_DIGEST="sha256:$(printf 'b%.0s' $(seq 1 64))"
failures=0
before=0

mkdir -p "$work/bin"

cat >"$work/bin/id" <<'EOF'
#!/usr/bin/env bash
[ "${STUB_NOT_ROOT:-}" = 1 ] && echo 1000 || echo 0
EOF

# Containers are files in the state dir: <name> exists, and <name>.running while it runs.
cat >"$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
state="$STUB_STATE/containers"
case "$1" in
  ps)
    for f in "$state"/*; do
      case "$f" in *.running) ;; *) [ -e "$f" ] && basename "$f" ;; esac
    done
    exit 0
    ;;
  stop)
    name="${*: -1}"
    echo "stop-$name" >>"$STUB_STATE/calls"
    case "${STUB_FAIL:-}:$name" in
      node-keeps-running:shiftgate-brewdial-api-*) exit 1 ;;
      kt-keeps-running:shiftgate-brewdial-api-kt-*) exit 1 ;;
    esac
    rm -f "$state/$name.running"
    exit 0
    ;;
  start)
    name="${*: -1}"
    echo "start-$name" >>"$STUB_STATE/calls"
    [ "${STUB_FAIL:-}" = node-wont-start ] && exit 1
    [ "${STUB_FAIL:-}" = node-never-answers ] && exit 0
    touch "$state/$name.running"
    exit 0
    ;;
  inspect)
    name="${*: -1}"
    [ -e "$state/$name" ] || exit 1
    [ -e "$state/$name.running" ] && echo true || echo false
    exit 0
    ;;
esac
mode=""; env_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) env_file="$2"; shift ;;
    BREWDIAL_COPY_MODE=*) mode="${1#BREWDIAL_COPY_MODE=}" ;;
  esac
  shift
done
n="$(cat "$STUB_STATE/copy_runs" 2>/dev/null || echo 0)"; n=$((n + 1)); echo "$n" >"$STUB_STATE/copy_runs"
echo "docker-$mode-$(basename "$env_file")-run$n" >>"$STUB_STATE/calls"
echo "jdbc connect postgres://brewdial_app:$STUB_SECRET@127.0.0.1:5432/brewdial"
echo "password=$STUB_SECRET and a raw url mysql://app:$STUB_SECRET@10.0.0.5:3306/brewdial"
if [ "${STUB_FAIL:-}" = "exit-on-$n" ]; then
  echo "COPY_CHECK_FAILED schema drift: [beans.x exists only in POSTGRESQL]"
  exit 1
fi
if [ "${STUB_FAIL:-}" = "mismatch-on-$n" ] || { [ "$n" = 1 ] && [ "${STUB_COMPARE_DIFFERS:-}" = 1 ]; }; then
  echo "COPY_VERIFY_MISMATCH source=POSTGRESQL target=MYSQL"
  exit 1
fi
if [ "${STUB_FAIL:-}" = "silent-on-$n" ]; then
  exit 0
fi
sha="$(printf 'c%.0s' $(seq 1 64))"
printf 'TABLE\tSOURCE_ROWS\tTARGET_ROWS\tSOURCE_SHA256\tTARGET_SHA256\tRESULT\n'
printf 'beans\t3\t3\t%s\t%s\tOK\n' "$sha" "$sha"
printf 'SEQUENCE\tSOURCE_VALUE\tTARGET_VALUE\tRESULT\nrecipe_code_seq\t42\t42\tOK\n'
echo "COPY_VERIFY_OK source=POSTGRESQL target=MYSQL tables=15 sequences=1"
EOF

cat >"$work/bin/shiftgate" <<'EOF'
#!/usr/bin/env bash
state="$STUB_STATE/containers"
case "$1" in
  status)
    node='{"name":"brewdial-api","state":{"active":{"color":"blue","digest":"node-digest"}}}'
    [ "${STUB_FAIL:-}" = no-node-colour ] && node='{"name":"brewdial-api"}'
    kt='{"name":"brewdial-api-kt"}'
    [ -e "$state/shiftgate-brewdial-api-kt-blue" ] && kt="{\"name\":\"brewdial-api-kt\",\"state\":{\"active\":{\"color\":\"blue\",\"digest\":\"${STUB_KT_DIGEST:-$STUB_DIGEST}\"}}}"
    printf '[%s,%s]\n' "$node" "$kt"
    ;;
  deploy)
    echo "shiftgate-deploy" >>"$STUB_STATE/calls"
    [ "${STUB_FAIL:-}" = deploy ] && { echo "unhealthy; nothing was flipped" >&2; exit 1; }
    touch "$state/shiftgate-brewdial-api-kt-blue"
    [ "${STUB_FAIL:-}" = kt-unhealthy ] || touch "$state/shiftgate-brewdial-api-kt-blue.running"
    # A Dagu job brings the Node API back during the window.
    if [ "${STUB_FAIL:-}" = node-restarted ]; then touch "$state/shiftgate-brewdial-api-blue.running"; fi
    ;;
esac
exit 0
EOF

# The Node API on :8020 and api-kt on :8021, each answering only while its container runs.
cat >"$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
state="$STUB_STATE/containers"
url=""; write_code=0
while [ $# -gt 0 ]; do
  case "$1" in
    -X|-m|-o) shift ;;
    -w) write_code=1; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
node_up=0; [ -e "$state/shiftgate-brewdial-api-blue.running" ] && node_up=1
kt_up=0; [ -e "$state/shiftgate-brewdial-api-kt-blue.running" ] && kt_up=1
[ "${STUB_FAIL:-}" = something-else-on-8020 ] && node_up=1
case "$url" in
  *:8020/*) up=$node_up ;;
  *:8021/*) up=$kt_up ;;
esac
if [ "$write_code" = 1 ]; then
  if [ "$up" = 1 ]; then printf '200'; else printf '503'; fi
  exit 0
fi
[ "$up" = 1 ] || exit 22
[ "${STUB_FAIL:-}" = save-fails ] && case "$url" in *:8020/api/grinders) exit 22 ;; esac
case "$url" in
  *:8020/api/beans)
    case "${STUB_FAIL:-}" in
      order) echo '[{"id":"b1"},{"id":"b2"}]' ;;
      nested-in-list) echo '[{"id":"b1","flavors":["a","b"]}]' ;;
      *) echo '[{"id":"b1","recipe_count":"2","created_at":"2026-03-01T01:02:03.654Z"}]' ;;
    esac
    ;;
  *:8021/api/beans)
    case "${STUB_FAIL:-}" in
      order) echo '[{"id":"b2"},{"id":"b1"}]' ;;
      nested-in-list) echo '[{"id":"b1","flavors":["b","a"]}]' ;;
      parity) echo '[{"id":"b1","recipe_count":3,"created_at":"2026-03-01T01:02:03.654321Z"}]' ;;
      *) echo '[{"id":"b1","recipe_count":2,"created_at":"2026-03-01T01:02:03.654321Z"}]' ;;
    esac
    ;;
  *:8020/api/recipes\?limit=100)
    case "${STUB_FAIL:-}" in
      recipe-order) echo '[{"code":"COF-0001","created_at":"2026-03-02T00:00:00.000Z"},{"code":"COF-0002","created_at":"2026-03-01T00:00:00.000Z"}]' ;;
      recipe-tie) echo '[{"code":"COF-0001","created_at":"2026-03-01T00:00:00.000Z"},{"code":"COF-0002","created_at":"2026-03-01T00:00:00.000Z"}]' ;;
      *) echo '[{"code":"COF-0001"}]' ;;
    esac
    ;;
  *:8021/api/recipes\?limit=100)
    case "${STUB_FAIL:-}" in
      recipe-order) echo '[{"code":"COF-0002","created_at":"2026-03-01T00:00:00.000Z"},{"code":"COF-0001","created_at":"2026-03-02T00:00:00.000Z"}]' ;;
      recipe-tie) echo '[{"code":"COF-0002","created_at":"2026-03-01T00:00:00.000Z"},{"code":"COF-0001","created_at":"2026-03-01T00:00:00.000Z"}]' ;;
      *) echo '[{"code":"COF-0001"}]' ;;
    esac
    ;;
  *:802[01]/api/recipes\?limit=1) echo '[{"code":"COF-0001"}]' ;;
  *:8020/api/recipes/COF-0001) echo '{"code":"COF-0001","steps":[{"t":0},{"t":45}]}' ;;
  *:8021/api/recipes/COF-0001)
    if [ "${STUB_FAIL:-}" = steps-order ]; then echo '{"code":"COF-0001","steps":[{"t":45},{"t":0}]}'
    else echo '{"code":"COF-0001","steps":[{"t":0},{"t":45}]}'
    fi
    ;;
  *) echo '[]' ;;
esac
EOF

# pg_dump through sudo, and the archive check.
cat >"$work/bin/sudo" <<'EOF'
#!/usr/bin/env bash
echo "safety-dump" >>"$STUB_STATE/calls"
[ "${STUB_FAIL:-}" = pg-dump ] && exit 1
echo "PGDMP"
EOF
cat >"$work/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
[ "${STUB_FAIL:-}" = pg-restore ] && exit 1
exit 0
EOF
chmod +x "$work"/bin/*

# Each scenario gets fresh state. Sets: output, status, calls, scenario, current.
run_scenario() {
  local name="$1" fail="$2"
  shift 2
  # Taken in and cleared here, so that no shell or mode can carry one into the next scenario.
  local node_up="${SCENARIO_NODE_UP:-1}" kt_up="${SCENARIO_KT_UP:-}" done_marker="${SCENARIO_DONE:-}"
  local mutate="${SCENARIO_MUTATE:-}" kt_digest="${SCENARIO_KT_DIGEST:-}" not_root="${SCENARIO_NOT_ROOT:-}"
  local compare_differs="${SCENARIO_COMPARE_DIFFERS:-}"
  unset SCENARIO_NODE_UP SCENARIO_KT_UP SCENARIO_DONE SCENARIO_MUTATE SCENARIO_KT_DIGEST SCENARIO_NOT_ROOT SCENARIO_COMPARE_DIFFERS
  scenario="$work/$name"
  rm -rf "$scenario"
  mkdir -p "$scenario/env" "$scenario/state/containers" "$scenario/lib" "$scenario/log"
  cat >"$scenario/env/brewdial-copy.env" <<EOF
DATABASE_URL=mysql://app:$SECRET@10.0.0.5:3306/brewdial?sslMode=REQUIRED
BREWDIAL_COPY_SOURCE_URL=postgres://brewdial_app:$SECRET@127.0.0.1:5432/brewdial
EOF
  cat >"$scenario/env/brewdial-rollback.env" <<EOF
DATABASE_URL=postgres://brewdial_app:$SECRET@127.0.0.1:5432/brewdial
BREWDIAL_COPY_SOURCE_URL=mysql://app:$SECRET@10.0.0.5:3306/brewdial?sslMode=REQUIRED
EOF
  cat >"$scenario/env/brewdial-api-kt.env" <<EOF
AGENT_TOKEN=$SECRET
DATABASE_URL=mysql://app:$SECRET@10.0.0.5:3306/brewdial?sslMode=REQUIRED
EOF
  chmod 600 "$scenario"/env/*
  touch "$scenario/state/containers/shiftgate-brewdial-api-blue"
  [ "$node_up" = 1 ] && touch "$scenario/state/containers/shiftgate-brewdial-api-blue.running"
  if [ "$kt_up" = 1 ]; then
    touch "$scenario/state/containers/shiftgate-brewdial-api-kt-blue" "$scenario/state/containers/shiftgate-brewdial-api-kt-blue.running"
  fi
  [ "$done_marker" = 1 ] && printf '%s\n' "$DIGEST" >"$scenario/lib/phase4-cutover-done"
  [ -n "$mutate" ] && (cd "$scenario" && eval "$mutate")
  : >"$scenario/state/calls"

  output="$(PATH="$work/bin:$PATH" \
    STUB_STATE="$scenario/state" STUB_SECRET="$SECRET" STUB_FAIL="$fail" STUB_DIGEST="$DIGEST" \
    STUB_KT_DIGEST="$kt_digest" STUB_NOT_ROOT="$not_root" STUB_COMPARE_DIFFERS="$compare_differs" \
    PHASE4_ENV_DIR="$scenario/env" PHASE4_STATE_DIR="$scenario/lib" PHASE4_LOG_DIR="$scenario/log" \
    PHASE4_BACKUP_DIR="$scenario/final-postgres" PHASE4_NODE_START_TIMEOUT=1 \
    bash "$script" "$@" 2>&1)"
  status=$?
  calls="$(cat "$scenario/state/calls")"
  current="$name"
}

bad() {
  printf 'FAIL %s: %s\n' "$current" "$1"
  printf '%s\n' "--- output" "$output" "--- calls" "$calls" "---"
  failures=$((failures + 1))
}

expect_no_secret() {
  case "$output" in *"$SECRET"*) bad "the fixture password was printed" ;; esac
  if grep -rl "$SECRET" "$scenario/log" >/dev/null 2>&1; then bad "a tool log holds the fixture password"; fi
}

passed() {
  expect_no_secret
  [ "$failures" -gt "$before" ] || printf 'ok   %s\n' "$current"
  before=$failures
}

expect_success() {
  [ "$status" = 0 ] || bad "expected success, got $status"
  [ -z "${1+x}" ] || [ "$calls" = "$1" ] || bad "calls were [$calls], expected [$1]"
  passed
}

# Stopped with a non-zero status at the named step, and no later call ran.
expect_stopped() {
  local stopped_at="$1" expected_calls="$2"
  [ "$status" -ne 0 ] || bad "expected a non-zero exit"
  case "$output" in *"PHASE4_FAILED step=$stopped_at:"*) ;; *) bad "expected PHASE4_FAILED step=$stopped_at" ;; esac
  [ "$calls" = "$expected_calls" ] || bad "calls were [$calls], expected [$expected_calls]"
  case "$output" in *"systemctl restart cloudflared"*) bad "printed the switch command after a failure" ;; esac
  passed
}

node_running() { [ -e "$scenario/state/containers/shiftgate-brewdial-api-blue.running" ]; }
marker_exists() { [ -e "$scenario/lib/phase4-cutover-done" ]; }
expect_node_stopped() { if node_running; then bad "the Node API should be stopped"; fi; }
expect_node_running() { node_running || bad "the Node API should be running"; }
expect_no_marker() { if marker_exists; then bad "there should be no cutover marker"; fi; }

STOP_NODE='stop-shiftgate-brewdial-api-blue'
STOP_KT='stop-shiftgate-brewdial-api-kt-blue'
START_NODE='start-shiftgate-brewdial-api-blue'
COPY1='docker-copy-brewdial-copy.env-run1'
VERIFY2='docker-verify-brewdial-copy.env-run2'
DEPLOY='shiftgate-deploy'
c1="$STOP_NODE
$COPY1"
c2="$c1
$VERIFY2"
c3="$c2
$DEPLOY"

# --- the full sequence ---
run_scenario happy "" cutover --digest "$DIGEST"
expect_node_stopped
[ "$(cat "$scenario/lib/phase4-cutover-done" 2>/dev/null)" = "$DIGEST" ] || bad "a finished cutover must record its digest"
[ -s "$scenario/log/fixtures/paths.tsv" ] || bad "the saved responses are missing"
case "$output" in *"sudo sed -i 's#http://127.0.0.1:8020#http://127.0.0.1:8021#' /etc/cloudflared/config.yml && sudo systemctl restart cloudflared"*) ;; *) bad "the switch command is missing" ;; esac
case "$output" in *"COPY_VERIFY_OK source=POSTGRESQL target=MYSQL tables=15 sequences=1"*) ;; *) bad "the report line is missing" ;; esac
case "$output" in *"recipe_code_seq	42	42	OK"*) ;; *) bad "the sequence report is missing" ;; esac
case "$output" in *"same: /api/beans"*) ;; *) bad "parity did not compare /api/beans" ;; esac
expect_success "$c3"

# --- a scenario's inputs do not reach the next one, even as plain assignments, which persist in every shell ---
SCENARIO_NOT_ROOT=1
SCENARIO_DONE=1
SCENARIO_NODE_UP=0
SCENARIO_MUTATE='rm env/brewdial-copy.env'
export SCENARIO_NOT_ROOT SCENARIO_DONE SCENARIO_NODE_UP SCENARIO_MUTATE
run_scenario isolation-first "" cutover --digest "$DIGEST" --preflight
[ "$status" -ne 0 ] || bad "the inputs of the first scenario were ignored"
leftover="$(compgen -v SCENARIO_ || true)"
[ -z "$leftover" ] || bad "still set after the scenario: $leftover"
passed
run_scenario isolation-second "" cutover --digest "$DIGEST" --preflight
expect_no_marker
[ -e "$scenario/env/brewdial-copy.env" ] || bad "the next scenario inherited the mutation"
expect_success ""

# --- preflight changes nothing ---
run_scenario preflight "" cutover --digest "$DIGEST" --preflight
case "$output" in *PHASE4_PREFLIGHT_OK*) ;; *) bad "no preflight result" ;; esac
expect_node_running
expect_success ""

# --- preflight: a failure touches nothing ---
SCENARIO_NOT_ROOT=1 run_scenario not-root "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_node_running
run_scenario bad-digest "" cutover --digest sha256:abc; expect_stopped preflight ""; expect_node_running
SCENARIO_MUTATE='rm env/brewdial-copy.env' run_scenario missing-copy-env "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_node_running
SCENARIO_MUTATE='rm env/brewdial-rollback.env' run_scenario missing-rollback-env "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_node_running
SCENARIO_MUTATE='chmod 644 env/brewdial-copy.env' run_scenario open-env "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_node_running
SCENARIO_MUTATE='sed -i "/^BREWDIAL_COPY_SOURCE_URL=/d" env/brewdial-copy.env' run_scenario missing-key "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_node_running
# The shape a wrong sed produces: a key twice, the last value the wrong one.
SCENARIO_MUTATE='echo "BREWDIAL_COPY_SOURCE_URL=postgres://x:y@h/d" >>env/brewdial-rollback.env' run_scenario duplicate-key "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_node_running
SCENARIO_MUTATE='sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://x:y@h/d#" env/brewdial-api-kt.env' run_scenario kt-env-on-postgres "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_node_running
run_scenario no-node-colour no-node-colour cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_node_running
SCENARIO_NODE_UP=0 run_scenario node-down-no-fixtures "" cutover --digest "$DIGEST"; expect_stopped preflight ""

# A finished cutover ends through rollback, never through a new copy: MySQL may hold the newest data.
finished_cutover_refused() {
  case "$output" in *"a finished cutover still stands"*) ;; *) bad "it must refuse because a finished cutover stands" ;; esac
}
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario cutover-over-finished "" cutover --digest "$DIGEST"; expect_stopped preflight ""; finished_cutover_refused
marker_exists || bad "the marker must survive a refused cutover"
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario replace-over-finished "" cutover --digest "$DIGEST" --replace-target; expect_stopped preflight ""; finished_cutover_refused
[ -e "$scenario/state/containers/shiftgate-brewdial-api-kt-blue.running" ] || bad "a refused cutover must leave api-kt running"

# Only one run at a time. The holder is this test's own process, stopped by its PID.
# shellcheck disable=SC2016
SCENARIO_MUTATE='mkdir -p log; ( exec 9>log/phase4.lock; flock 9; echo "$BASHPID" >lock.pid; exec sleep 30 ) >/dev/null 2>&1 & until [ -s lock.pid ]; do sleep 0.1; done' \
  run_scenario second-run "" cutover --digest "$DIGEST"
kill "$(cat "$scenario/lock.pid")" 2>/dev/null
expect_stopped preflight ""; expect_node_running
case "$output" in *"another heatwave-phase4.sh is running"*) ;; *) bad "the message must name the other run" ;; esac

# --- each step: nothing after it runs, and no marker ---
run_scenario save-fails save-fails cutover --digest "$DIGEST"; expect_stopped save ""; expect_node_running; expect_no_marker
run_scenario node-keeps-running node-keeps-running cutover --digest "$DIGEST"; expect_stopped stop "$STOP_NODE"; expect_no_marker
run_scenario something-else-on-8020 something-else-on-8020 cutover --digest "$DIGEST"; expect_stopped stop "$STOP_NODE"; expect_no_marker
run_scenario copy-exit exit-on-1 cutover --digest "$DIGEST"; expect_stopped copy "$c1"; expect_node_stopped; expect_no_marker
case "$output" in *"COPY_CHECK_FAILED schema drift"*) ;; *) bad "the drift message is missing" ;; esac
case "$output" in *"rollback --digest"*) ;; *) bad "the way out of the window is missing" ;; esac
run_scenario copy-mismatch mismatch-on-1 cutover --digest "$DIGEST"; expect_stopped copy "$c1"; expect_no_marker
run_scenario copy-unproven silent-on-1 cutover --digest "$DIGEST"; expect_stopped copy "$c1"; expect_no_marker
run_scenario verify-fails mismatch-on-2 cutover --digest "$DIGEST"; expect_stopped verify "$c2"; expect_no_marker
run_scenario deploy-fails deploy cutover --digest "$DIGEST"; expect_stopped start "$c3"; expect_no_marker
SCENARIO_KT_DIGEST="$OTHER_DIGEST" run_scenario wrong-kt-digest "" cutover --digest "$DIGEST"; expect_stopped start "$c3"; expect_no_marker
run_scenario kt-unhealthy kt-unhealthy cutover --digest "$DIGEST"; expect_stopped start "$c3"; expect_no_marker
run_scenario parity-differs parity cutover --digest "$DIGEST"; expect_stopped parity "$c3"; expect_no_marker
run_scenario node-restarted node-restarted cutover --digest "$DIGEST"; expect_stopped finish "$c3"; expect_no_marker
case "$output" in *"Dagu"*) ;; *) bad "the message must point at the Dagu jobs" ;; esac

# --- --replace-target is the only way to overwrite the target ---
run_scenario replace-target "" cutover --digest "$DIGEST" --replace-target
case "$calls" in "$STOP_NODE
docker-replace-brewdial-copy.env-run1"*) ;; *) bad "calls began [$calls]" ;; esac
passed

# --- a retry: the Node API is already stopped, and the saved responses stand in for it ---
# shellcheck disable=SC2016
SAVED='mkdir -p log/fixtures; echo "[{\"id\":\"b1\",\"recipe_count\":2,\"created_at\":\"2026-03-01T01:02:03.654Z\"}]" | jq -S . >log/fixtures/1.json; printf "1\t/api/beans\n" >log/fixtures/paths.tsv'
SCENARIO_NODE_UP=0 SCENARIO_MUTATE="$SAVED" run_scenario retry-with-saved-responses "" cutover --digest "$DIGEST" --replace-target
case "$output" in *"keeping the responses from the earlier run"*) ;; *) bad "the retry must keep the saved responses" ;; esac
case "$output" in *"same: /api/beans"*) ;; *) bad "parity did not use the saved responses" ;; esac
[ "$status" = 0 ] || bad "the retry should pass"
passed
# api-kt from an earlier attempt must not run during the new copy.
SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 SCENARIO_MUTATE="$SAVED" run_scenario retry-stops-api-kt "" cutover --digest "$DIGEST" --replace-target
case "$calls" in "$STOP_NODE
$STOP_KT
docker-replace"*) ;; *) bad "api-kt must stop before the copy: [$calls]" ;; esac
passed

# --- an order-only difference stops unless the desk accepted it; a real one always stops ---
run_scenario order-differs order cutover --digest "$DIGEST"; expect_stopped parity "$c3"
run_scenario order-accepted order cutover --digest "$DIGEST" --accept-order
case "$output" in *"same apart from order (--accept-order): /api/beans"*) ;; *) bad "the accepted difference must be reported" ;; esac
expect_success "$c3"
run_scenario content-with-accept parity cutover --digest "$DIGEST" --accept-order; expect_stopped parity "$c3"
# --accept-order covers the order of a name-sorted list, and rows with one timestamp, and nothing else.
run_scenario steps-order-with-accept steps-order cutover --digest "$DIGEST" --accept-order; expect_stopped parity "$c3"
run_scenario nested-in-list-with-accept nested-in-list cutover --digest "$DIGEST" --accept-order; expect_stopped parity "$c3"
run_scenario recipe-list-with-accept recipe-order cutover --digest "$DIGEST" --accept-order; expect_stopped parity "$c3"
run_scenario recipe-tie-without-accept recipe-tie cutover --digest "$DIGEST"; expect_stopped parity "$c3"
run_scenario recipe-tie-with-accept recipe-tie cutover --digest "$DIGEST" --accept-order
case "$output" in *"same apart from rows with equal created_at"*) ;; *) bad "the accepted tie must be reported" ;; esac
expect_success "$c3"

# --- rollback before MySQL served: no copy can run, whatever MySQL holds ---
SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario rollback-no-cutover "" rollback --digest "$DIGEST"
expect_node_running
case "$output" in *"PostgreSQL is untouched"*) ;; *) bad "the message must say PostgreSQL is untouched" ;; esac
expect_success "$STOP_KT
$STOP_NODE
$START_NODE"

# --- rollback after a cutover, with MySQL unchanged: compare, then just start Node ---
COMPARE='docker-verify-brewdial-copy.env-run1'
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario rollback-no-writes "" rollback --digest "$DIGEST"
expect_node_running; expect_no_marker
case "$output" in *"MySQL took no writes"*) ;; *) bad "the message must say MySQL took no writes" ;; esac
case "$output" in *"sudo sed -i 's#http://127.0.0.1:8021#http://127.0.0.1:8020#' /etc/cloudflared/config.yml && sudo systemctl restart cloudflared"*) ;; *) bad "the switch back is missing" ;; esac
expect_success "$STOP_KT
$STOP_NODE
$COMPARE
$START_NODE"

# --- rollback after MySQL took writes: the full reverse copy, while nothing runs ---
REVERSE="$STOP_KT
$STOP_NODE
$COMPARE
safety-dump"
REPLACE2='docker-replace-brewdial-rollback.env-run2'
VERIFY3='docker-verify-brewdial-rollback.env-run3'
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario rollback-with-writes mismatch-on-1 rollback --digest "$DIGEST"
expect_node_running; expect_no_marker
ls "$scenario"/final-postgres/pre-rollback-*.dump >/dev/null 2>&1 || bad "the safety dump is missing"
expect_success "$REVERSE
$REPLACE2
$VERIFY3
$START_NODE"

# --- rollback failures: the Node API stays stopped and the rollback can run again ---
retryable() { marker_exists || bad "a failed rollback must stay retryable"; expect_node_stopped; }
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario rollback-kt-keeps-running kt-keeps-running rollback --digest "$DIGEST"; expect_stopped stop "$STOP_KT"; retryable
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario rollback-compare-breaks exit-on-1 rollback --digest "$DIGEST"; expect_stopped compare "$STOP_KT
$STOP_NODE
$COMPARE"; retryable
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario rollback-compare-unproven silent-on-1 rollback --digest "$DIGEST"; expect_stopped compare "$STOP_KT
$STOP_NODE
$COMPARE"; retryable
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 run_scenario rollback-other-image "" rollback --digest "$OTHER_DIGEST"; expect_stopped preflight ""
SCENARIO_NODE_UP=0 run_scenario rollback-no-node-colour no-node-colour rollback --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_MUTATE='rm env/brewdial-rollback.env' run_scenario rollback-missing-env "" rollback --digest "$DIGEST"; expect_stopped preflight ""

# MySQL differs, and then a later step fails.
writes_on_mysql() { SCENARIO_COMPARE_DIFFERS=1 SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario "$@"; }
writes_on_mysql rollback-dump-fails pg-dump rollback --digest "$DIGEST"; expect_stopped safety-dump "$REVERSE"; retryable
writes_on_mysql rollback-archive-unreadable pg-restore rollback --digest "$DIGEST"; expect_stopped safety-dump "$REVERSE"; retryable
writes_on_mysql rollback-replace-fails exit-on-2 rollback --digest "$DIGEST"; expect_stopped replace "$REVERSE
$REPLACE2"; retryable
writes_on_mysql rollback-verify-fails exit-on-3 rollback --digest "$DIGEST"; expect_stopped verify "$REVERSE
$REPLACE2
$VERIFY3"; retryable

# The data is safe by then. A Node API that cannot start must not hide that, or repeat the copy.
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario rollback-node-wont-start node-wont-start rollback --digest "$DIGEST"; expect_stopped start "$STOP_KT
$STOP_NODE
$COMPARE
$START_NODE"; expect_no_marker
SCENARIO_NODE_UP=0 run_scenario rollback-node-never-answers node-never-answers rollback --digest "$DIGEST"; expect_stopped start "$STOP_NODE
$START_NODE"

# --- rollback --preflight changes nothing ---
SCENARIO_DONE=1 SCENARIO_NODE_UP=0 SCENARIO_KT_UP=1 run_scenario rollback-preflight "" rollback --digest "$DIGEST" --preflight
marker_exists || bad "preflight must leave the marker"
expect_success ""

# r4436714502: the exact command the runbook gives for the rollback env file.
runbook="$here/../../../docs/runbooks/oci-heatwave-cutover.md"
if [ -r "$runbook" ]; then
  current="runbook-rollback-env-command"
  output=""; calls=""
  scenario="$work/runbook-env"
  mkdir -p "$scenario"
  printf 'DATABASE_URL=mysql://app:pw@10.0.0.5:3306/brewdial\nBREWDIAL_COPY_SOURCE_URL=postgres://brewdial_app:pw@127.0.0.1:5432/brewdial\n' >"$scenario/brewdial-copy.env"
  command_line="$(grep -m1 "umask 077; sed -nE" "$runbook" | sed -E "s#^ *sudo sh -c '##; s#'\$##; s#/etc/shiftgate#$scenario#g")"
  [ -n "$command_line" ] || bad "the runbook command was not found"
  sh -c "$command_line"
  expected='BREWDIAL_COPY_SOURCE_URL=mysql://app:pw@10.0.0.5:3306/brewdial
DATABASE_URL=postgres://brewdial_app:pw@127.0.0.1:5432/brewdial'
  [ "$(cat "$scenario/brewdial-rollback.env" 2>/dev/null)" = "$expected" ] || bad "the rollback env file is wrong: it must swap both keys"
  [ "$(stat -c %a "$scenario/brewdial-rollback.env" 2>/dev/null)" = 600 ] || bad "the rollback env file must be 0600"
  passed
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "PHASE4_SCRIPT_TESTS_OK"
