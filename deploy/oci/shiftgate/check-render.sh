#!/usr/bin/env bash
# Renders deploy/oci/shiftgate/services.yaml with the real shiftgate binary and
# validates the generated HAProxy file with `haproxy -c`. Touches no host state:
# state_dir, the HAProxy file and the socket path are redirected to a temp dir,
# and HAProxy is never reloaded.
#
# Needs: shiftgate on PATH (go install github.com/mgh3326/shiftgate/cmd/shiftgate@<rev>)
#        and either haproxy >= 2.8 on PATH or HAPROXY_IMAGE=<image> with docker.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
services="${1:-$here/services.yaml}"
work="$(mktemp -d "${TMPDIR:-/tmp}/shiftgate-render.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if [[ -n "${HAPROXY_IMAGE:-}" ]]; then
  check="[\"docker\", \"run\", \"--rm\", \"--network\", \"none\", \"-v\", \"$work:$work:ro\", \"$HAPROXY_IMAGE\", \"haproxy\", \"-c\", \"-f\", \"{config}\"]"
  haproxy_c() { docker run --rm --network none -v "$work:$work:ro" "$HAPROXY_IMAGE" haproxy -c -f "$1"; }
else
  command -v haproxy >/dev/null || { echo "haproxy not found (or set HAPROXY_IMAGE)" >&2; exit 2; }
  check='["haproxy", "-c", "-f", "{config}"]'
  haproxy_c() { haproxy -c -f "$1"; }
fi

allowed_binds="$(grep -E '^  allowed_binds:' "$services")"
[[ -n "$allowed_binds" ]] || { echo "no haproxy.allowed_binds in $services" >&2; exit 1; }
# Keep the production log and timeout settings (single-line keys).
passthrough="$(grep -E '^  (log|timeouts|allow_wildcard_bind):' "$services" || true)"

# Host-level settings point into $work; the services section is used verbatim.
{
  echo "state_dir: $work/state"
  echo "haproxy:"
  echo "  config: $work/haproxy.cfg"
  echo "  socket: $work/admin.sock"
  echo "  check: $check"
  echo "  reload: [\"false\"]"
  echo "$allowed_binds"
  [[ -z "$passthrough" ]] || echo "$passthrough"
  sed -n '/^services:/,$p' "$services"
} > "$work/services.yaml"
mkdir -p "$work/state"

echo "== shiftgate render --no-reload (validates the candidate with haproxy -c, installs into $work) =="
shiftgate --config "$work/services.yaml" render --no-reload
echo "== haproxy -c on the installed file =="
haproxy_c "$work/haproxy.cfg" && echo "haproxy -c: configuration file is valid"
echo "== rendered frontends/backends =="
grep -E '^(frontend|backend)|^\s+(bind|server|option httpchk)' "$work/haproxy.cfg"
echo "OK: $services renders and validates"
