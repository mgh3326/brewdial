#!/usr/bin/env bash
# Checks that heatwave_load turns a DATABASE_URL into the option file the MySQL
# clients need: credentials decoded exactly once, and bad URLs refused without
# echoing them. Needs no database or docker.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../heatwave-client.sh
. "$here/../heatwave-client.sh"

work="$(mktemp -d "${TMPDIR:-/tmp}/heatwave-client-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
export TMPDIR="$work"
failures=0
host=10.0.0.5:3306

load_url() {
  printf 'DATABASE_URL=%s\n' "$1" >"$work/env"
  heatwave_load "$work/env" 2>"$work/stderr"
}

# expect_password <name> <password as written in the URL> <exact option-file line>
expect_password() {
  local name="$1" encoded="$2" expected="$3" line
  if ! load_url "mysql://app:$encoded@$host/brewdial"; then
    printf 'FAIL %s: refused\n' "$name"
    failures=$((failures + 1))
    return
  fi
  line="$(grep '^password=' "$HEATWAVE_TMP/client.cnf")"
  if [ "$line" = "password=\"$expected\"" ]; then
    printf 'ok   %s\n' "$name"
  else
    printf 'FAIL %s: got [%s], wanted [password="%s"]\n' "$name" "$line" "$expected"
    failures=$((failures + 1))
  fi
  heatwave_unload
}

# expect_refused <name> <url>
expect_refused() {
  local name="$1" url="$2"
  if load_url "$url"; then
    printf 'FAIL %s: accepted\n' "$name"
    failures=$((failures + 1))
    heatwave_unload
  elif grep -q 'not-for-output' "$work/stderr"; then
    printf 'FAIL %s: the error message printed the credential\n' "$name"
    failures=$((failures + 1))
  else
    printf 'ok   %s\n' "$name"
  fi
}

# The right column is option-file syntax: a backslash and a double quote are escaped.
expect_password 'plain' 'secret' 'secret'
expect_password 'encoded reserved characters' 'p%40ss%23w%2Fd' 'p@ss#w/d'
expect_password 'encoded quote and backslash' 'a%22b%5Cc' 'a\"b\\c'
expect_password 'encoded percent is decoded once' '100%2541' '100%41'
expect_password 'encoded backslash before a letter stays literal' '%5Cn' '\\n'
expect_password 'utf-8' '%ED%95%9C%EA%B8%80' '한글'
expect_password 'empty' '' ''
# r4436139578: printf %b would turn each of these into a control or other character.
expect_password 'literal backslash-t' 'a\tb' 'a\\tb'
expect_password 'literal backslash-n' 'a\nb' 'a\\nb'
expect_password 'literal backslash-0' 'a\0b' 'a\\0b'
expect_password 'literal backslash-x' 'a\x41b' 'a\\x41b'
expect_password 'literal double backslash' 'a\\b' 'a\\\\b'
# shellcheck disable=SC1003
expect_password 'trailing backslash' 'ab\' 'ab\\'

expect_refused 'stray percent' "mysql://app:not-for-output%@$host/brewdial"
expect_refused 'one hex digit' "mysql://app:not-for-output%4@$host/brewdial"
expect_refused 'not hex' "mysql://app:not-for-output%ZZ@$host/brewdial"
expect_refused 'encoded newline' "mysql://app:not-for-output%0A@$host/brewdial"
expect_refused 'encoded NUL' "mysql://app:not-for-output%00@$host/brewdial"
expect_refused 'wrong scheme' "postgres://app:not-for-output@$host/brewdial"
if [ -n "$HEATWAVE_TMP" ]; then
  printf 'FAIL a refused URL left an option file\n'
  failures=$((failures + 1))
fi

# r4436181195: these would break or truncate an option-file line, or pass as an option.
expect_refused 'host with a space' 'mysql://app:not-for-output@ba d:3306/brewdial'
expect_refused 'host with a comment character' 'mysql://app:not-for-output@bad#host:3306/brewdial'
expect_refused 'host with a semicolon' 'mysql://app:not-for-output@bad;host:3306/brewdial'
expect_refused 'host with a quote' 'mysql://app:not-for-output@bad"host:3306/brewdial'
expect_refused 'database that reads as an option' "mysql://app:not-for-output@$host/--all-databases"
expect_refused 'database with a space' "mysql://app:not-for-output@$host/bad name"

# A real private DNS name and port arrive unchanged.
load_url 'mysql://app:pw@heatwave-1.sub.vcn.oraclevcn.com:3307/brew_dial-1'
if grep -qx 'host=heatwave-1.sub.vcn.oraclevcn.com' "$HEATWAVE_TMP/client.cnf" \
  && grep -qx 'port=3307' "$HEATWAVE_TMP/client.cnf" && [ "$HEATWAVE_DB" = brew_dial-1 ]; then
  printf 'ok   host, port and database\n'
else
  printf 'FAIL host, port and database\n'
  failures=$((failures + 1))
fi
heatwave_unload

# The last active DATABASE_URL wins; commented examples do not participate.
cat >"$work/env" <<'EOF'
DATABASE_URL=mysql://first:pw@first.example/first
# DATABASE_URL=mysql://commented:pw@commented.example/commented
  # DATABASE_URL=mysql://indented:pw@indented.example/indented
DATABASE_URL=mysql://last:pw@last.example/last
EOF
if heatwave_load "$work/env" 2>"$work/stderr" \
  && grep -qx 'user="last"' "$HEATWAVE_TMP/client.cnf" \
  && grep -qx 'host=last.example' "$HEATWAVE_TMP/client.cnf" \
  && [ "$HEATWAVE_DB" = last ]; then
  printf 'ok   last non-comment DATABASE_URL wins\n'
else
  printf 'FAIL last non-comment DATABASE_URL wins\n'
  failures=$((failures + 1))
fi
heatwave_unload

# A user is decoded and quoted the same way.
load_url "mysql://a%22b:pw@$host/brewdial"
if grep -qxF 'user="a\"b"' "$HEATWAVE_TMP/client.cnf"; then
  printf 'ok   user quoting\n'
else
  printf 'FAIL user quoting\n'
  failures=$((failures + 1))
fi
mode="$(stat -c '%a' "$HEATWAVE_TMP/client.cnf" 2>/dev/null || stat -f '%Lp' "$HEATWAVE_TMP/client.cnf")"
if [ "$mode" = 600 ]; then
  printf 'ok   option file is 0600\n'
else
  printf 'FAIL option file is not 0600\n'
  failures=$((failures + 1))
fi
heatwave_unload

load_url "mysql://app:pw@$host/brewdial?sslMode=REQUIRED"
if grep -qx 'ssl-mode=REQUIRED' "$HEATWAVE_TMP/client.cnf" && [ "$HEATWAVE_DB" = brewdial ]; then
  printf 'ok   ssl mode and database\n'
else
  printf 'FAIL ssl mode and database\n'
  failures=$((failures + 1))
fi
heatwave_unload

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed"
  exit 1
fi
echo "HEATWAVE_CLIENT_TESTS_OK"
