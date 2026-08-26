#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set to the local test database URI}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
api_kt_dir="$(cd "$script_dir/.." && pwd)"
repo_dir="$(cd "$api_kt_dir/../.." && pwd)"
server_log="$(mktemp "${TMPDIR:-/tmp}/brewdial-kt-contract.XXXXXX.log")"
server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -f "$server_log"
}
trap cleanup EXIT INT TERM

if lsof -nP -i :3021 >/dev/null 2>&1; then
  echo "Port 3021 is already in use; refusing to run contract tests." >&2
  exit 1
fi

cd "$api_kt_dir"
./gradlew --no-daemon bootJar

jar_path="$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' -print -quit)"
if [[ -z "$jar_path" ]]; then
  echo "bootJar did not produce an executable jar" >&2
  exit 1
fi

DATABASE_URL="$DATABASE_URL" AGENT_TOKEN=test-token java -jar "$jar_path" >"$server_log" 2>&1 &
server_pid="$!"

ready=0
for _ in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:3021/api/db/health >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  echo "Spring API did not become ready at /api/db/health within 60 seconds." >&2
  sed -n '1,240p' "$server_log" >&2
  exit 1
fi

vitest_args=()
for arg in "$@"; do
  case "$arg" in
    apps/api/*)
      # pnpm --filter executes from apps/api, while callers commonly provide
      # repository-root-relative paths from the task matrix.
      vitest_args+=("${arg#apps/api/}")
      ;;
    "$repo_dir"/apps/api/*)
      vitest_args+=("${arg#"$repo_dir"/apps/api/}")
      ;;
    *)
      vitest_args+=("$arg")
      ;;
  esac
done

cd "$repo_dir"
API_TEST_BASE_URL=http://127.0.0.1:3021 pnpm --filter @brewdial/api exec vitest run "${vitest_args[@]}"
