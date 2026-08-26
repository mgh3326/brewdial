#!/usr/bin/env bash
# Operator-only comparison helper. Run on the OCI box after a pod is Ready:
#   deploy/oci/k3s/measure-api.sh brewdial-api 30020
#   deploy/oci/k3s/measure-api.sh brewdial-api-kt 30021
# It emits one Markdown data row for a before/after cutover record.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <app-label> <nodeport>" >&2
  exit 64
fi

APP_LABEL="$1"
NODEPORT="$2"
NAMESPACE="${BREWDIAL_NAMESPACE:-brewdial}"

if ! [[ "$APP_LABEL" =~ ^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$ ]]; then
  echo "app label must be a DNS-like Kubernetes label value" >&2
  exit 64
fi
if ! [[ "$NODEPORT" =~ ^[0-9]+$ ]] || (( NODEPORT < 1 || NODEPORT > 65535 )); then
  echo "nodeport must be an integer between 1 and 65535" >&2
  exit 64
fi

POD="$(kubectl -n "$NAMESPACE" get pods -l "app=${APP_LABEL}" \
  --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')"
if [[ -z "$POD" ]]; then
  echo "no running pod found for app=${APP_LABEL} in namespace ${NAMESPACE}" >&2
  exit 1
fi

CONTAINER_STARTED_AT="$(kubectl -n "$NAMESPACE" get pod "$POD" \
  -o jsonpath='{.status.containerStatuses[?(@.name=="api")].state.running.startedAt}')"
if [[ -z "$CONTAINER_STARTED_AT" ]]; then
  echo "api container is not running in pod ${POD}" >&2
  exit 1
fi

# Kubernetes prepends the log timestamp. Match Spring's "Started …" and the
# Node API's "brewdial-api on" line so the same calculation compares both.
STARTED_LOG_LINE="$(kubectl -n "$NAMESPACE" logs "$POD" -c api --timestamps \
  | awk '/Started .* in|brewdial-api on/ { line = $0 } END { print line }')"
if [[ -z "$STARTED_LOG_LINE" ]]; then
  echo "startup log line not found in ${POD}; expected 'Started …' or 'brewdial-api on'" >&2
  exit 1
fi

LOG_TIMESTAMP="${STARTED_LOG_LINE%% *}"
CONTAINER_STARTED_MS="$(date -d "$CONTAINER_STARTED_AT" +%s%3N)"
LOG_STARTED_MS="$(date -d "$LOG_TIMESTAMP" +%s%3N)"
STARTUP_MS="$(( LOG_STARTED_MS - CONTAINER_STARTED_MS ))"

# cgroup v2 values are comparable pod memory signals; report raw bytes rather
# than a host-wide metric so the result can be pasted into a Markdown table.
MEMORY_CURRENT="$(kubectl -n "$NAMESPACE" exec "$POD" -c api -- sh -c 'cat /sys/fs/cgroup/memory.current')"
MEMORY_PEAK="$(kubectl -n "$NAMESPACE" exec "$POD" -c api -- sh -c 'cat /sys/fs/cgroup/memory.peak')"

LATENCIES_FILE="$(mktemp)"
trap 'rm -f "$LATENCIES_FILE"' EXIT
for _ in $(seq 1 100); do
  curl --fail --silent --show-error --output /dev/null \
    --write-out '%{time_total}\n' \
    "http://127.0.0.1:${NODEPORT}/api/db/health" >> "$LATENCIES_FILE"
done
sort -n "$LATENCIES_FILE" -o "$LATENCIES_FILE"

P50_SECONDS="$(sed -n '50p' "$LATENCIES_FILE")"
P99_SECONDS="$(sed -n '99p' "$LATENCIES_FILE")"
P50_MS="$(awk -v seconds="$P50_SECONDS" 'BEGIN { printf "%.2f", seconds * 1000 }')"
P99_MS="$(awk -v seconds="$P99_SECONDS" 'BEGIN { printf "%.2f", seconds * 1000 }')"

printf '| app | pod | memory.current (B) | memory.peak (B) | startup (ms) | p50 (ms) | p99 (ms) |\n'
printf '| --- | --- | ---: | ---: | ---: | ---: | ---: |\n'
printf '| %s | %s | %s | %s | %s | %s | %s |\n' \
  "$APP_LABEL" "$POD" "$MEMORY_CURRENT" "$MEMORY_PEAK" "$STARTUP_MS" "$P50_MS" "$P99_MS"
