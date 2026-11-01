#!/usr/bin/env bash
# Drives deploy/oci/heatwave-phase4.sh against stub docker, shiftgate, curl and
# id commands. Each scenario fails one check and asserts that the script stops
# there, runs nothing after it, and prints no fixture secret. Every stub output
# that could carry a credential tries to leak the fixture password.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/../heatwave-phase4.sh"
work="$(mktemp -d "${TMPDIR:-/tmp}/phase4-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

SECRET="phase4-fixture-$$-value"
DIGEST="sha256:$(printf 'a%.0s' $(seq 1 64))"
OTHER_DIGEST="sha256:$(printf 'b%.0s' $(seq 1 64))"
failures=0

mkdir -p "$work/bin"

cat >"$work/bin/id" <<'EOF'
#!/usr/bin/env bash
[ "${STUB_NOT_ROOT:-}" = 1 ] && echo 1000 || echo 0
EOF

# Copy tool: report lines plus a credential in the log, as a driver error might print it.
cat >"$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
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
if [ "${STUB_FAIL:-}" = "copy-exit" ] && [ "$n" = 1 ]; then
  echo "COPY_CHECK_FAILED schema drift: [beans.x exists only in POSTGRESQL]"
  exit 1
fi
if [ "${STUB_FAIL:-}" = "copy-mismatch" ] && [ "$n" = 1 ]; then
  echo "COPY_VERIFY_MISMATCH source=POSTGRESQL target=MYSQL"
  exit 0
fi
if [ "${STUB_FAIL:-}" = "verify" ] && [ "$n" = 2 ]; then
  echo "COPY_VERIFY_MISMATCH source=POSTGRESQL target=MYSQL"
  exit 1
fi
if [ "${STUB_FAIL:-}" = "final-verify" ] && [ "$n" = 3 ]; then
  echo "COPY_VERIFY_MISMATCH source=POSTGRESQL target=MYSQL"
  exit 1
fi
sha="$(printf 'c%.0s' $(seq 1 64))"
printf 'TABLE\tSOURCE_ROWS\tTARGET_ROWS\tSOURCE_SHA256\tTARGET_SHA256\tRESULT\n'
printf 'beans\t3\t3\t%s\t%s\tOK\n' "$sha" "$sha"
printf 'SEQUENCE\tSOURCE_VALUE\tTARGET_VALUE\tRESULT\nrecipe_code_seq\t42\t42\tOK\n'
echo "COPY_VERIFY_OK source=POSTGRESQL target=MYSQL tables=15 sequences=1"
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

cat >"$work/bin/shiftgate" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  status)
    color="$(cat "$STUB_STATE/color")"
    digest="${STUB_ACTIVE_DIGEST:-$STUB_DIGEST}"
    case "$color" in
      blue) printf '[{"name":"brewdial-api-kt","state":{"active":{"color":"blue","digest":"%s"},"rollback_available":false}}]\n' "$digest" ;;
      green) printf '[{"name":"brewdial-api-kt","state":{"active":{"color":"green","digest":"%s"},"previous":{"color":"blue","digest":"%s"},"rollback_available":true}}]\n' "$digest" "$digest" ;;
    esac
    ;;
  deploy)
    echo "shiftgate-deploy" >>"$STUB_STATE/calls"
    [ "${STUB_FAIL:-}" = deploy ] && { echo "unhealthy; the previous colour keeps serving" >&2; exit 1; }
    grep -c '^DATABASE_URL=mysql://' "$STUB_KT_ENV" >"$STUB_STATE/kt_env_at_deploy"
    [ "${STUB_FAIL:-}" = deploy-noop ] || echo green >"$STUB_STATE/color"
    ;;
esac
EOF

# The Node API on :8020 and api-kt on :8021.
cat >"$work/bin/curl" <<'EOF'
#!/usr/bin/env bash
method=GET; url=""; write_code=0
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift ;;
    -m|-o) shift ;;
    -w) write_code=1; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
respond() { [ "$write_code" = 1 ] && printf '%s' "$1"; [ "$write_code" = 1 ] || cat; }
case "$url" in
  */api/write-freeze-probe)
    if [ "${STUB_FAIL:-}" = no-switch ]; then printf '404'
    elif [ "${STUB_FAIL:-}" = old-node ]; then printf '401'
    elif [ "${STUB_FAIL:-}" = stuck-frozen ]; then printf '503'
    elif [ -e "$STUB_FREEZE" ]; then printf '503'
    else printf '404'
    fi
    ;;
  *:8020/api/db/health) [ "${STUB_FAIL:-}" = node-down ] && printf '503' || printf '200' ;;
  *:8021/api/db/health)
    if [ "${STUB_FAIL:-}" = kt-down ] && [ "$(cat "$STUB_STATE/color")" = green ]; then printf '503'; else printf '200'; fi
    ;;
  *:8020/api/beans)
    if [ "${STUB_FAIL:-}" = order ]; then echo '[{"id":"b1"},{"id":"b2"}]'
    elif [ "${STUB_FAIL:-}" = nested-in-list ]; then echo '[{"id":"b1","flavors":["a","b"]}]'
    else echo '[{"id":"b1","recipe_count":"2","created_at":"2026-03-01T01:02:03.654Z"}]'
    fi
    ;;
  *:8021/api/beans)
    if [ "${STUB_FAIL:-}" = order ]; then echo '[{"id":"b2"},{"id":"b1"}]'
    elif [ "${STUB_FAIL:-}" = nested-in-list ]; then echo '[{"id":"b1","flavors":["b","a"]}]'
    elif [ "${STUB_FAIL:-}" = parity ]; then echo '[{"id":"b1","recipe_count":3,"created_at":"2026-03-01T01:02:03.654321Z"}]'
    else echo '[{"id":"b1","recipe_count":2,"created_at":"2026-03-01T01:02:03.654321Z"}]'
    fi
    ;;
  *:802[01]/api/recipes\?limit=1) echo '[{"code":"COF-0001"}]' ;;
  *:8020/api/recipes\?limit=100)
    if [ "${STUB_FAIL:-}" = recipe-order ]; then echo '[{"code":"COF-0001"},{"code":"COF-0002"}]'
    else echo '[{"code":"COF-0001"}]'
    fi
    ;;
  *:8021/api/recipes\?limit=100)
    if [ "${STUB_FAIL:-}" = recipe-order ]; then echo '[{"code":"COF-0002"},{"code":"COF-0001"}]'
    else echo '[{"code":"COF-0001"}]'
    fi
    ;;
  *:8020/api/recipes/COF-0001) echo '{"code":"COF-0001","steps":[{"t":0},{"t":45}]}' ;;
  *:8021/api/recipes/COF-0001)
    if [ "${STUB_FAIL:-}" = steps-order ]; then echo '{"code":"COF-0001","steps":[{"t":45},{"t":0}]}'
    else echo '{"code":"COF-0001","steps":[{"t":0},{"t":45}]}'
    fi
    ;;
  *) echo '[]' ;;
esac
EOF
chmod +x "$work"/bin/*

# Each scenario gets fresh state. Sets: output, status, calls.
run_scenario() {
  local name="$1" fail="$2"
  shift 2
  scenario="$work/$name"
  rm -rf "$scenario"
  mkdir -p "$scenario/env" "$scenario/state" "$scenario/freeze" "$scenario/log"
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
DATABASE_URL=postgres://brewdial_app:$SECRET@127.0.0.1:5432/brewdial
EOF
  chmod 600 "$scenario"/env/*
  echo "${SCENARIO_COLOR:-blue}" >"$scenario/state/color"
  [ "${SCENARIO_FROZEN:-}" = 1 ] && touch "$scenario/freeze/write-freeze"
  [ "${SCENARIO_VERIFIED:-}" = 1 ] && touch "$scenario/freeze/write-freeze.cutover-verified"
  printf 'ingress:\n  - service: %s\n' "${SCENARIO_INGRESS:-http://127.0.0.1:8020}" >"$scenario/config.yml"
  [ -n "${SCENARIO_MUTATE:-}" ] && (cd "$scenario" && eval "$SCENARIO_MUTATE")
  : >"$scenario/state/calls"

  output="$(PATH="$work/bin:$PATH" \
    STUB_STATE="$scenario/state" STUB_SECRET="$SECRET" STUB_FAIL="$fail" STUB_DIGEST="$DIGEST" \
    STUB_FREEZE="$scenario/freeze/write-freeze" STUB_KT_ENV="$scenario/env/brewdial-api-kt.env" \
    STUB_ACTIVE_DIGEST="${SCENARIO_ACTIVE_DIGEST:-}" STUB_NOT_ROOT="${SCENARIO_NOT_ROOT:-}" \
    PHASE4_ENV_DIR="$scenario/env" PHASE4_FREEZE_FILE="$scenario/freeze/write-freeze" \
    PHASE4_CLOUDFLARED_CONFIG="$scenario/config.yml" PHASE4_LOG_DIR="$scenario/log" PHASE4_DRAIN_SECONDS=0 \
    PHASE4_BACKUP_DIR="$scenario/final-postgres" \
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
}

# Stopped with a non-zero status at the named step, and no later call ran.
expect_stopped() {
  local step="$1" expected_calls="$2"
  [ "$status" -ne 0 ] || bad "expected a non-zero exit"
  case "$output" in *"PHASE4_FAILED step=$step:"*) ;; *) bad "expected PHASE4_FAILED step=$step" ;; esac
  [ "$calls" = "$expected_calls" ] || bad "calls were [$calls], expected [$expected_calls]"
  case "$output" in *"systemctl restart cloudflared"*) bad "printed the switch command after a failure" ;; esac
  expect_no_secret
  [ "$failures" -gt "${before:-0}" ] || printf 'ok   %s\n' "$current"
  before=$failures
}

expect_frozen() { [ -e "$scenario/freeze/write-freeze" ] || bad "writes should stay frozen"; }
expect_not_frozen() { [ ! -e "$scenario/freeze/write-freeze" ] || bad "writes should not be frozen"; }

COPY1='docker-copy-brewdial-copy.env-run1'
VERIFY2='docker-verify-brewdial-copy.env-run2'
VERIFY3='docker-verify-brewdial-copy.env-run3'
DEPLOY='shiftgate-deploy'
c1="$COPY1"
c2="$COPY1
$VERIFY2"
c3="$COPY1
$VERIFY2
$DEPLOY"
c4="$c3
$VERIFY3"

# --- the full sequence ---
run_scenario happy "" cutover --digest "$DIGEST"
[ "$status" = 0 ] || bad "expected success, got $status"
[ "$calls" = "$c4" ] || bad "calls were [$calls], expected [$c4]"
case "$output" in *"sudo sed -i 's#http://127.0.0.1:8020#http://127.0.0.1:8021#' $scenario/config.yml && sudo systemctl restart cloudflared"*) ;; *) bad "the switch command is missing" ;; esac
case "$output" in *"COPY_VERIFY_OK source=POSTGRESQL target=MYSQL tables=15 sequences=1"*) ;; *) bad "the report line is missing" ;; esac
case "$output" in *"recipe_code_seq	42	42	OK"*) ;; *) bad "the sequence report is missing" ;; esac
grep -q http://127.0.0.1:8020 "$scenario/config.yml" || bad "the script must not edit cloudflared"
[ "$(cat "$scenario/state/kt_env_at_deploy")" = 1 ] || bad "api-kt env must hold the MySQL URL at deploy time"
grep -q "^AGENT_TOKEN=$SECRET" "$scenario/env/brewdial-api-kt.env" || bad "api-kt env lost its other keys"
[ "$(stat -c %a "$scenario/env/brewdial-api-kt.env")" = 600 ] || bad "api-kt env must stay 0600"
grep -q '^DATABASE_URL=postgres://' "$scenario/env/brewdial-api-kt.env.postgres" || bad "the PostgreSQL env must be kept"
[ "$(stat -c %a "$scenario/env/brewdial-api-kt.env.postgres")" = 600 ] || bad "the kept env must stay 0600"
expect_frozen
[ -e "$scenario/freeze/write-freeze.cutover-verified" ] || bad "a finished cutover must allow its rollback"
expect_no_secret
if grep -rl "$SECRET" "$scenario/log" >/dev/null; then bad "a tool log holds the fixture password"; fi
[ "$failures" -gt 0 ] || printf 'ok   %s\n' "$current"
before=$failures

# --- preflight changes nothing ---
run_scenario preflight "" cutover --digest "$DIGEST" --preflight
[ "$status" = 0 ] || bad "preflight should pass"
case "$output" in *PHASE4_PREFLIGHT_OK*) ;; *) bad "no preflight result" ;; esac
[ -z "$calls" ] || bad "preflight ran [$calls]"
expect_not_frozen
expect_no_secret
[ "$failures" -gt "$before" ] || printf 'ok   %s\n' "$current"
before=$failures

# --- one failure at each check: nothing after it runs ---
SCENARIO_NOT_ROOT=1 run_scenario not-root "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_not_frozen
run_scenario bad-digest "" cutover --digest sha256:abc; expect_stopped preflight ""; expect_not_frozen
SCENARIO_MUTATE='rm env/brewdial-copy.env' run_scenario missing-env "" cutover --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_MUTATE='rm env/brewdial-rollback.env' run_scenario missing-rollback-env "" cutover --digest "$DIGEST"; expect_stopped preflight ""
# The shape a wrong sed produces: a key twice, the last value the wrong one.
SCENARIO_MUTATE='echo "BREWDIAL_COPY_SOURCE_URL=postgres://x:y@h/d" >>env/brewdial-rollback.env' run_scenario duplicate-key "" cutover --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_MUTATE='chmod 644 env/brewdial-copy.env' run_scenario open-env "" cutover --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_MUTATE='sed -i "/^BREWDIAL_COPY_SOURCE_URL=/d" env/brewdial-copy.env' run_scenario missing-key "" cutover --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_MUTATE='rm -r freeze' run_scenario no-freeze-dir "" cutover --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_INGRESS=http://127.0.0.1:8021 run_scenario ingress-on-kt "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_not_frozen
SCENARIO_COLOR=green run_scenario already-green "" cutover --digest "$DIGEST"; expect_stopped preflight ""; expect_not_frozen
SCENARIO_ACTIVE_DIGEST="$OTHER_DIGEST" run_scenario other-digest "" cutover --digest "$DIGEST"; expect_stopped preflight ""
run_scenario node-down node-down cutover --digest "$DIGEST"; expect_stopped preflight ""
run_scenario old-node old-node cutover --digest "$DIGEST"; expect_stopped preflight ""
run_scenario switch-ignored no-switch cutover --digest "$DIGEST"; expect_stopped freeze ""
run_scenario copy-exit copy-exit cutover --digest "$DIGEST"; expect_stopped copy "$c1"; expect_frozen
case "$output" in *"COPY_CHECK_FAILED schema drift"*) ;; *) bad "the drift message is missing" ;; esac
run_scenario copy-mismatch copy-mismatch cutover --digest "$DIGEST"; expect_stopped copy "$c1"; expect_frozen
run_scenario verify-fails verify cutover --digest "$DIGEST"; expect_stopped verify "$c2"; expect_frozen
run_scenario deploy-fails deploy cutover --digest "$DIGEST"; expect_stopped deploy "$c3"; expect_frozen
run_scenario deploy-noop deploy-noop cutover --digest "$DIGEST"; expect_stopped deploy "$c3"; expect_frozen
run_scenario kt-unhealthy kt-down cutover --digest "$DIGEST"; expect_stopped deploy "$c3"; expect_frozen
run_scenario parity-differs parity cutover --digest "$DIGEST"; expect_stopped parity "$c3"; expect_frozen
run_scenario final-verify-fails final-verify cutover --digest "$DIGEST"; expect_stopped final-verify "$c4"; expect_frozen

# --- an order-only difference stops unless the desk accepted it; a real one always stops ---
run_scenario order-differs order cutover --digest "$DIGEST"; expect_stopped parity "$c3"; expect_frozen
run_scenario order-accepted order cutover --digest "$DIGEST" --accept-order
[ "$status" = 0 ] || bad "expected success with --accept-order"
case "$output" in *"same apart from order (--accept-order): /api/beans"*) ;; *) bad "the accepted difference must be reported" ;; esac
expect_no_secret
[ "$failures" -gt "$before" ] || printf 'ok   %s\n' "$current"
before=$failures
run_scenario content-with-accept parity cutover --digest "$DIGEST" --accept-order; expect_stopped parity "$c3"; expect_frozen
# --accept-order covers the order of a name-sorted list and nothing else.
run_scenario steps-order-with-accept steps-order cutover --digest "$DIGEST" --accept-order; expect_stopped parity "$c3"; expect_frozen
run_scenario nested-in-list-with-accept nested-in-list cutover --digest "$DIGEST" --accept-order; expect_stopped parity "$c3"; expect_frozen
run_scenario recipe-list-with-accept recipe-order cutover --digest "$DIGEST" --accept-order; expect_stopped parity "$c3"; expect_frozen

# --- --replace-target is the only way to overwrite the target ---
run_scenario replace-target "" cutover --digest "$DIGEST" --replace-target
[ "$status" = 0 ] || bad "expected success"
case "$calls" in docker-replace-brewdial-copy.env-run1*) ;; *) bad "first call was [$calls]" ;; esac
expect_no_secret
[ "$failures" -gt "$before" ] || printf 'ok   %s\n' "$current"
before=$failures

# --- a cutover that failed does not unlock a rollback ---
run_scenario failed-cutover-marker verify cutover --digest "$DIGEST"
[ ! -e "$scenario/freeze/write-freeze.cutover-verified" ] || bad "a failed cutover must not allow a rollback"
expect_no_secret
[ "$failures" -gt "$before" ] || printf 'ok   %s\n' "$current"
before=$failures

# --- rollback ---
SAFETY='safety-dump'
ROLLBACK1='docker-replace-brewdial-rollback.env-run1'
ROLLBACK2='docker-verify-brewdial-rollback.env-run2'
SCENARIO_COLOR=green SCENARIO_FROZEN=1 SCENARIO_VERIFIED=1 run_scenario rollback-happy "" rollback --digest "$DIGEST"
[ "$status" = 0 ] || bad "expected success, got $status"
[ "$calls" = "$SAFETY
$ROLLBACK1
$ROLLBACK2" ] || bad "calls were [$calls]"
expect_frozen
[ ! -e "$scenario/freeze/write-freeze.cutover-verified" ] || bad "a second rollback must be refused"
ls "$scenario"/final-postgres/pre-rollback-*.dump >/dev/null 2>&1 || bad "the safety dump is missing"
expect_no_secret
case "$output" in *"unfreeze"*) ;; *) bad "the next step is missing" ;; esac
case "$output" in *"brewdial-api-kt.env.postgres"*) ;; *) bad "the env restore is missing" ;; esac
[ "$failures" -gt "$before" ] || printf 'ok   %s\n' "$current"
before=$failures

SCENARIO_COLOR=green SCENARIO_VERIFIED=1 run_scenario rollback-not-frozen "" rollback --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_COLOR=green SCENARIO_FROZEN=1 run_scenario rollback-without-cutover "" rollback --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_COLOR=green SCENARIO_FROZEN=1 SCENARIO_VERIFIED=1 SCENARIO_INGRESS=http://127.0.0.1:8021 run_scenario rollback-traffic-on-kt "" rollback --digest "$DIGEST"; expect_stopped preflight ""
SCENARIO_COLOR=green SCENARIO_FROZEN=1 SCENARIO_VERIFIED=1 run_scenario rollback-dump-fails pg-dump rollback --digest "$DIGEST"; expect_stopped safety-dump "$SAFETY"
SCENARIO_COLOR=green SCENARIO_FROZEN=1 SCENARIO_VERIFIED=1 run_scenario rollback-archive-unreadable pg-restore rollback --digest "$DIGEST"; expect_stopped safety-dump "$SAFETY"
SCENARIO_COLOR=green SCENARIO_FROZEN=1 SCENARIO_VERIFIED=1 run_scenario rollback-replace-fails copy-exit rollback --digest "$DIGEST"; expect_stopped replace "$SAFETY
$ROLLBACK1"; expect_frozen
[ -e "$scenario/freeze/write-freeze.cutover-verified" ] || bad "a failed rollback must stay retryable"
SCENARIO_COLOR=green SCENARIO_FROZEN=1 SCENARIO_VERIFIED=1 run_scenario rollback-verify-fails verify rollback --digest "$DIGEST"; expect_stopped verify "$SAFETY
$ROLLBACK1
$ROLLBACK2"; expect_frozen

# --- unfreeze ---
SCENARIO_FROZEN=1 SCENARIO_VERIFIED=1 run_scenario unfreeze "" unfreeze
[ "$status" = 0 ] || bad "unfreeze should pass"
expect_not_frozen
[ ! -e "$scenario/freeze/write-freeze.cutover-verified" ] || bad "after an unfreeze MySQL is stale: rollback must be refused"
[ "$failures" -gt "$before" ] || printf 'ok   %s\n' "$current"
before=$failures
SCENARIO_FROZEN=1 SCENARIO_INGRESS=http://127.0.0.1:8021 run_scenario unfreeze-traffic-on-kt "" unfreeze; expect_stopped unfreeze ""; expect_frozen

# A failed unfreeze must not take the rollback away: PostgreSQL never reopened.
SCENARIO_FROZEN=1 SCENARIO_VERIFIED=1 run_scenario unfreeze-not-honoured stuck-frozen unfreeze; expect_stopped unfreeze ""
[ -e "$scenario/freeze/write-freeze.cutover-verified" ] || bad "the cutover marker must survive a failed unfreeze"
SCENARIO_COLOR=green SCENARIO_VERIFIED=1 run_scenario rollback-after-failed-unfreeze stuck-frozen rollback --digest "$DIGEST" --preflight
[ "$status" = 0 ] || bad "rollback must stay available after a failed unfreeze"
expect_no_secret
[ "$failures" -gt "$before" ] || printf 'ok   %s\n' "$current"
before=$failures

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "PHASE4_SCRIPT_TESTS_OK"
