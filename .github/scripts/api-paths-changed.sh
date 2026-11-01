#!/usr/bin/env bash
# Prints true when a change touches what the Kotlin API tests cover, else false.
# Usage: api-paths-changed.sh <base commit>   (compares it with HEAD)
#
# A required check must report on every PR, so ci-kt.yml always runs and skips the
# database jobs when this prints false. Any doubt prints true: the tests run.
set -uo pipefail

base="${1:-}"
paths='^(apps/api-kt/|packages/db/|\.github/workflows/ci-kt\.yml$|\.github/scripts/api-paths-changed\.sh$)'

# --no-renames lists both sides, so moving a file out of a covered path still counts.
if ! changed="$(git diff --no-renames --name-only "$base" HEAD 2>/dev/null)"; then
  echo "cannot compare with base '$base'; running the tests" >&2
  echo true
  exit 0
fi

matches="$(printf '%s\n' "$changed" | grep -E "$paths" | head -n 5)"
if [ -n "$matches" ]; then
  printf 'covered path changed: %s\n' "$matches" >&2
  echo true
else
  echo "no covered path changed" >&2
  echo false
fi
