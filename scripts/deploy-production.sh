#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_SHA="${1:-}"
DEPLOY_BRANCH="${2:-production}"
APP_DIR="${BREWDIAL_APP_DIR:-/Users/mgh3326/work/brewdial}"
SERVICE_LABEL="${BREWDIAL_SERVICE_LABEL:-com.robinco.brewdial.web}"
LOCAL_BASE_URL="${BREWDIAL_LOCAL_BASE_URL:-http://127.0.0.1:3020}"

log() {
  printf '[brewdial-deploy] %s\n' "$*"
}

cd "$APP_DIR"

log "deploy branch: $DEPLOY_BRANCH"
if [ -n "$DEPLOY_SHA" ]; then
  log "requested sha: ${DEPLOY_SHA}"
fi

log "fetching origin/${DEPLOY_BRANCH}"
git fetch --prune origin "+refs/heads/${DEPLOY_BRANCH}:refs/remotes/origin/${DEPLOY_BRANCH}"

REMOTE_SHA="$(git rev-parse "origin/${DEPLOY_BRANCH}")"
if [ -n "$DEPLOY_SHA" ] && [ "$DEPLOY_SHA" != "$REMOTE_SHA" ]; then
  log "error: requested sha does not match origin/${DEPLOY_BRANCH}"
  log "origin/${DEPLOY_BRANCH}: ${REMOTE_SHA}"
  exit 1
fi

log "checking out ${DEPLOY_BRANCH} at ${REMOTE_SHA}"
git checkout -B "$DEPLOY_BRANCH" "origin/${DEPLOY_BRANCH}"
git reset --hard "$REMOTE_SHA"

log "installing dependencies"
pnpm install --frozen-lockfile

log "building web and MCP packages"
pnpm build

log "running MCP smoke test"
pnpm mcp:smoke

log "restarting launchd service ${SERVICE_LABEL}"
launchctl kickstart -k "gui/$(id -u)/${SERVICE_LABEL}"

log "waiting for local health checks"
python3 - <<'PY'
import sys
import time
import urllib.request
import os

base = os.environ.get('BREWDIAL_LOCAL_BASE_URL', 'http://127.0.0.1:3020')
paths = ['/api/health', '/api/db/health']
last_error = None

for attempt in range(1, 16):
    try:
        results = []
        for path in paths:
            url = base + path
            with urllib.request.urlopen(url, timeout=5) as r:
                body = r.read(300).decode(errors='replace').replace('\n', ' ')
                if r.status != 200:
                    raise RuntimeError(f'{path} returned HTTP {r.status}: {body}')
                results.append((path, r.status, body))
        for path, status, body in results:
            print(f'{path} {status} {body}')
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001 - deploy smoke should report any failure.
        last_error = exc
        time.sleep(1)

print(f'health checks failed: {last_error}', file=sys.stderr)
sys.exit(1)
PY

log "deploy complete: ${REMOTE_SHA}"
