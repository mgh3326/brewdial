#!/usr/bin/env bash
set -euo pipefail

server_pid=""

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

pnpm --filter @brewdial/db build
pnpm build

AGENT_TOKEN=test-token HOST=127.0.0.1 PORT=3020 node dist/server.js &
server_pid=$!

for attempt in {1..30}; do
  if curl --fail --silent --show-error http://127.0.0.1:3020/api/db/health >/dev/null; then
    API_TEST_BASE_URL=http://127.0.0.1:3020 pnpm exec vitest run
    exit 0
  fi
  sleep 1
done

echo 'API server did not become healthy within 30 seconds' >&2
exit 1
