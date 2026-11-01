#!/usr/bin/env bash
# Renders deploy/oci/shiftgate/services.yaml with the real shiftgate binary and
# validates the generated HAProxy file with `haproxy -c`. Touches no host state:
# only state_dir, the HAProxy paths and the check/reload commands are redirected
# to a temp dir; every other setting comes from the production file. HAProxy is
# never reloaded.
#
# Needs: shiftgate on PATH (see SHIFTGATE_REV in .github/workflows/shiftgate-render.yml)
#        and either haproxy >= 2.8 on PATH or HAPROXY_IMAGE=<image> with docker.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
services="${1:-$here/services.yaml}"
work="$(mktemp -d "${TMPDIR:-/tmp}/shiftgate-render.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if [[ -n "${HAPROXY_IMAGE:-}" ]]; then
  # The temp dir is mode 0700 and the image's default user cannot read it.
  owner="$(id -u):$(id -g)"
  check="[\"docker\", \"run\", \"--rm\", \"--network\", \"none\", \"--user\", \"$owner\", \"-v\", \"$work:$work:ro\", \"$HAPROXY_IMAGE\", \"haproxy\", \"-c\", \"-f\", \"{config}\"]"
  haproxy_c() { docker run --rm --network none --user "$owner" -v "$work:$work:ro" "$HAPROXY_IMAGE" haproxy -c -f "$1"; }
else
  command -v haproxy >/dev/null || { echo "haproxy not found (or set HAPROXY_IMAGE)" >&2; exit 2; }
  check='["haproxy", "-c", "-f", "{config}"]'
  haproxy_c() { haproxy -c -f "$1"; }
fi

# The production file with host paths and commands replaced. A list value may
# span several lines, up to the line with the closing bracket.
awk -v work="$work" -v check="$check" '
  skip { if (/\]/) skip = 0; next }
  /^state_dir:/ { print "state_dir: " work "/state"; next }
  /^haproxy:/ {
    print
    print "  config: " work "/haproxy.cfg"
    print "  socket: " work "/admin.sock"
    print "  check: " check
    print "  reload: [\"false\"]"
    next
  }
  /^  (config|socket|socket_in_config):/ { next }
  /^  (check|reload):/ { if ($0 !~ /\]/) skip = 1; next }
  { print }
' "$services" > "$work/services.yaml"
mkdir -p "$work/state"

echo "== shiftgate render --no-reload (validates the candidate with haproxy -c, installs into $work) =="
shiftgate --config "$work/services.yaml" render --no-reload
echo "== haproxy -c on the installed file =="
haproxy_c "$work/haproxy.cfg" && echo "haproxy -c: configuration file is valid"
echo "== rendered frontends/backends and settings =="
grep -E '^(frontend|backend)|^\s+(bind|server|option httpchk|timeout)' "$work/haproxy.cfg"
echo "OK: $services renders and validates"
