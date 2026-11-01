#!/usr/bin/env bash
# Sourced by backup-heatwave.sh and verify-restore-heatwave.sh. Runs the MySQL
# clients from a pinned image, with the credentials in a temporary 0600 option
# file instead of argv, so they never reach the process list or the output.

MYSQL_CLIENT_IMAGE="${MYSQL_CLIENT_IMAGE:-docker.io/library/mysql:8.4@sha256:a0225d1ea6631c8bc2385dc4c2faba17bbf1834ecf369e1659a9a382bd8d5dd7}"
HEATWAVE_TMP=""
HEATWAVE_DB=""

# Writes the option file from the DATABASE_URL line of an env file.
heatwave_load() {
  local env_file="$1" url user password host port query ssl_mode=""
  url="$(grep -E '^DATABASE_URL=' "$env_file" | cut -d= -f2-)" || { echo "no DATABASE_URL in $env_file" >&2; return 1; }
  local pattern='^mysql://([^:@/]+)(:([^@/]*))?@([^:/?]+)(:([0-9]+))?/([^?]+)(\?(.*))?$'
  [[ "$url" =~ $pattern ]] || { echo "DATABASE_URL in $env_file is not a mysql:// URL" >&2; return 1; }
  user="${BASH_REMATCH[1]}"
  password="${BASH_REMATCH[3]}"
  host="${BASH_REMATCH[4]}"
  port="${BASH_REMATCH[6]:-3306}"
  HEATWAVE_DB="${BASH_REMATCH[7]}"
  query="${BASH_REMATCH[9]}"
  [[ "&$query" =~ \&sslMode=([A-Za-z_]+) ]] && ssl_mode="${BASH_REMATCH[1]}"
  # A URL percent-encodes reserved characters; the option file needs them plain.
  user="$(printf '%b' "${user//%/\\x}")"
  password="$(printf '%b' "${password//%/\\x}")"
  password="${password//\\/\\\\}"
  password="${password//\"/\\\"}"
  HEATWAVE_TMP="$(mktemp -d "${TMPDIR:-/tmp}/heatwave-client.XXXXXX")"
  (
    umask 077
    {
      echo '[client]'
      printf 'user="%s"\n' "$user"
      printf 'password="%s"\n' "$password"
      printf 'host=%s\nport=%s\n' "$host" "$port"
      printf 'default-character-set=utf8mb4\n'
      [ -z "$ssl_mode" ] || printf 'ssl-mode=%s\n' "$ssl_mode"
    } >"$HEATWAVE_TMP/client.cnf"
  )
}

heatwave_unload() {
  [ -z "$HEATWAVE_TMP" ] || rm -rf "$HEATWAVE_TMP"
  HEATWAVE_TMP=""
}

# heatwave_client <mysql|mysqldump> [args...]: stdin and stdout pass through.
heatwave_client() {
  local tool="$1"
  shift
  docker run --rm -i --network host -v "$HEATWAVE_TMP/client.cnf:/run/heatwave-client.cnf:ro" \
    "$MYSQL_CLIENT_IMAGE" "$tool" --defaults-extra-file=/run/heatwave-client.cnf "$@"
}

# One consistent, restorable logical dump to stdout. No --databases: the file holds
# no USE or CREATE DATABASE, so a restore can never touch the live schema by name.
heatwave_dump() {
  heatwave_client mysqldump --single-transaction --no-tablespaces --set-gtid-purged=OFF \
    --triggers --hex-blob "$HEATWAVE_DB"
}

# Fails unless the file is intact gzip and mysqldump reached its last line.
heatwave_check_dump() {
  gzip -t "$1"
  gzip -dc "$1" | tail -n 1 | grep -q '^-- Dump completed'
}
