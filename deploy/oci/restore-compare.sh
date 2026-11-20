# shellcheck shell=bash
# Per-table comparison of the restored copy with live. Sourced by
# verify-restore-heatwave.sh and by deploy/oci/test/restore-compare-test.sh, so the
# test runs the code the gate runs. The caller defines:
#   log <message>        prints one line
#   note_fail <message>  records one mismatch
#   q_live <sql>         read-only query on the live schema, batch output
#   q_restored <sql>     query on the restored copy, batch output
#   restored_load        reads SQL on stdin and runs it on the restored copy
# Logs carry table, column and row counts only. No value is ever printed.
#
# JSON columns are left out of the row checksum. Each one is compared by value:
# live streams (primary key, JSON text) into a scratch table on the restored server,
# and the restored server parses both sides as JSON. MySQL compares JSON numbers as
# numbers, so 1.0 and 1 match, while a changed element, key or NULL-vs-value does not.

# compare_table <table>: the row count and a checksum over the non-JSON columns, as
# before, then each JSON column by value when the table has any.
compare_table() {
  local table="$1" columns sql live restored json_cols
  json_cols="$(q_live "select column_name from information_schema.columns where table_schema = database() and table_name = '$table' and data_type = 'json' order by ordinal_position")"
  columns="$(q_live "set session group_concat_max_len = 1000000; select group_concat(concat('\`', column_name, '\`') order by ordinal_position) from information_schema.columns where table_schema = database() and table_name = '$table' and data_type <> 'json'")"
  sql="select concat(count(*), '|', coalesce(bit_xor(cast(conv(substr(md5(json_array($columns)), 1, 16), 16, 10) as unsigned)), 0)) from \`$table\`"
  live="$(q_live "$sql")"
  restored="$(q_restored "$sql")"
  if [ "$live" = "$restored" ]; then log "  ok $table ($live)"; else note_fail "$table live=[$live] restored=[$restored]"; fi
  if [ -n "$json_cols" ]; then compare_json_columns "$table" "$json_cols"; fi
}

# compare_json_columns <table> <json column names, one per line>
compare_json_columns() {
  local table="$1" json_cols="$2" pk_cols first_pk="" key_live="" key_restored="" select_live
  local n=0 i=0 c rk sql out label count idx col rows=0

  pk_cols="$(q_live "select column_name from information_schema.key_column_usage where table_schema = database() and table_name = '$table' and constraint_name = 'PRIMARY' order by ordinal_position")"
  if [ -z "$pk_cols" ]; then
    note_fail "$table has JSON columns but no primary key to match rows by"
    return 0
  fi
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    [ -n "$first_pk" ] || first_pk="$c"
    key_live="$key_live, cast(\`$c\` as char)"
    key_restored="$key_restored, cast(r.\`$c\` as char)"
  done <<<"$pk_cols"

  # Live side, read-only: one row per live row, the key then one token per JSON column.
  select_live="select hex(concat_ws(char(31 using utf8mb4)$key_live))"
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    n=$((n + 1))
    select_live="$select_live, coalesce(concat('v', hex(cast(\`$c\` as char))), 'n')"
  done <<<"$json_cols"
  select_live="$select_live from \`$table\`"

  # Scratch table on the restored server, outside the restored data. Regular table,
  # not TEMPORARY, so it survives between the separate sessions used below.
  {
    printf "drop table if exists \`_jv_%s\`;\n" "$table"
    printf "create table \`_jv_%s\` (k varchar(512) character set utf8mb4 collate utf8mb4_bin not null primary key" "$table"
    for ((i = 1; i <= n; i++)); do printf ', j%d longtext' "$i"; done
    printf ');\n'
  } | restored_load

  q_live "$select_live" | awk -v tbl="_jv_$table" -v n="$n" '
    NF == 0 { next }
    {
      s = "insert into `" tbl "` values (convert(unhex(\047" $1 "\047) using utf8mb4)"
      for (i = 2; i <= n + 1; i++)
        s = s (($i == "n") ? ", NULL" : ", convert(unhex(\047" substr($i, 2) "\047) using utf8mb4)")
      print s ");"
    }' | restored_load

  # Join key on the restored side, computed the same way as the live key.
  rk="concat_ws(char(31 using utf8mb4)$key_restored) collate utf8mb4_bin"
  sql="select 'rows', count(*) from \`_jv_$table\`
    union all select 'live_row_missing', count(*) from \`_jv_$table\` t left join \`$table\` r on t.k = $rk where r.\`$first_pk\` is null
    union all select 'restored_row_extra', count(*) from \`$table\` r left join \`_jv_$table\` t on t.k = $rk where t.k is null"
  i=0
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    i=$((i + 1))
    sql="$sql
    union all select 'json:$i', count(*) from \`_jv_$table\` t join \`$table\` r on t.k = $rk where not (r.\`$c\` <=> cast(t.j$i as json))"
  done <<<"$json_cols"

  out="$(q_restored "$sql")"
  q_restored "drop table if exists \`_jv_$table\`" >/dev/null

  while IFS=$'\t' read -r label count; do
    case "$label" in
      rows) rows=$count ;;
      live_row_missing) [ "$count" = 0 ] || note_fail "$table: $count live row(s) not found in the restored copy" ;;
      restored_row_extra) [ "$count" = 0 ] || note_fail "$table: $count restored row(s) not found in live" ;;
      json:*)
        idx="${label#json:}"
        col="$(printf '%s\n' "$json_cols" | awk -v n="$idx" 'NR == n')"
        [ "$count" = 0 ] || note_fail "$table.$col: $count row(s) differ in JSON value"
        ;;
    esac
  done <<<"$out"
  log "  json $table ($rows rows, $n JSON column(s) compared by value)"
}
