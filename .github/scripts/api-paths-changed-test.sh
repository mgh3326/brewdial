#!/usr/bin/env bash
# Checks api-paths-changed.sh in a throwaway repository shaped like a pull_request
# merge commit, whose first parent is the base branch. Needs only git.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/api-paths-changed.sh"
repo="$(mktemp -d "${TMPDIR:-/tmp}/api-paths-test.XXXXXX")"
trap 'rm -rf "$repo"' EXIT
cd "$repo" || exit 1
failures=0

git_quiet() { git -c user.name=test -c user.email=test@example.test "$@" >/dev/null 2>&1; }

git init -q -b main .
mkdir -p apps/api-kt/src apps/api/src apps/miniapp packages/db/src packages/shared/src gradle docs .github/workflows
for file in apps/api-kt/src/A.kt apps/api/src/app.ts apps/miniapp/m.ts packages/db/src/db.ts packages/shared/src/s.ts \
  README.md docs/d.md pnpm-lock.yaml .github/workflows/ci.yml .github/workflows/ci-kt.yml; do
  echo "$file" >"$file"
done
git add -A
git_quiet commit -m base
base="$(git rev-parse HEAD)"

# check <name> <expected> <shell command that makes the change>
check() {
  local name="$1" expected="$2" change="$3" got
  git checkout -q "$base"
  git checkout -q -B pr
  bash -c "$change"
  git add -A
  git_quiet commit --allow-empty -m change
  git checkout -q "$base"
  git checkout -q -B merged
  git_quiet commit --allow-empty -m 'base moved'
  git_quiet merge --no-ff --no-edit pr
  got="$(bash "$script" 'HEAD^1' 2>/dev/null)"
  if [ "$got" = "$expected" ]; then
    printf 'ok   %s: %s\n' "$name" "$got"
  else
    printf 'FAIL %s: got %s, wanted %s\n' "$name" "$got" "$expected"
    failures=$((failures + 1))
  fi
}

# What the Kotlin API tests build from or run.
check 'api-kt' true 'echo x >> apps/api-kt/src/A.kt'
check 'moved out of api-kt' true 'git mv apps/api-kt/src/A.kt moved.kt'
check 'packages/db' true 'echo x >> packages/db/src/db.ts'
check 'migration' true 'mkdir -p packages/db/migrations; echo x > packages/db/migrations/008.sql'
check 'packages/shared: the engine the Kotlin tests compare with' true 'echo x >> packages/shared/src/s.ts'
check 'apps/api: the contract suite' true 'echo x >> apps/api/src/app.ts'
check 'this workflow' true 'echo x >> .github/workflows/ci-kt.yml'
check 'this script' true 'mkdir -p .github/scripts; echo x > .github/scripts/api-paths-changed.sh'
check 'this test' true 'mkdir -p .github/scripts; echo x > .github/scripts/api-paths-changed-test.sh'
# r4436149285: root build inputs.
check 'root settings.gradle' true 'echo x > settings.gradle'
check 'root settings.gradle.kts' true 'echo x > settings.gradle.kts'
check 'root build.gradle.kts' true 'echo x > build.gradle.kts'
check 'root gradle.properties' true 'echo x > gradle.properties'
check 'root gradle wrapper' true 'mkdir -p gradle/wrapper; echo x > gradle/wrapper/gradle-wrapper.properties'
check 'version catalog' true 'mkdir -p gradle; echo x > gradle/libs.versions.toml'
check 'root gradlew' true 'echo x > gradlew'
check 'root gradlew.bat' true 'echo x > gradlew.bat'
check 'pnpm lockfile' true 'echo x >> pnpm-lock.yaml'
check 'pnpm workspace' true 'echo x > pnpm-workspace.yaml'
check 'root package.json' true 'echo x > package.json'
check 'mixed change' true 'echo x >> README.md; echo x >> apps/api-kt/src/A.kt'

# Unrelated changes must still pass quickly.
check 'docs' false 'echo x >> README.md; echo x >> docs/d.md'
check 'miniapp' false 'echo x >> apps/miniapp/m.ts'
check 'similar directory' false 'mkdir -p apps/api-kt2; echo x > apps/api-kt2/x'
check 'similar workflow' false 'echo x > .github/workflows/ci-kt2.yml'
check 'another workflow' false 'echo x >> .github/workflows/ci.yml'
check 'similar root file' false 'echo x > gradle.properties.md'
check 'nested file named like a root input' false 'echo x > docs/package.json'
check 'nothing changed' false 'true'

# Any doubt runs the tests.
for bad_base in '' 0000000000000000000000000000000000000000 deadbeefdeadbeefdeadbeefdeadbeefdeadbeef; do
  got="$(bash "$script" "$bad_base" 2>/dev/null)"
  if [ "$got" = true ]; then
    printf 'ok   base [%s]: runs the tests\n' "$bad_base"
  else
    printf 'FAIL base [%s]: got %s\n' "$bad_base" "$got"
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "API_PATHS_TESTS_OK"
