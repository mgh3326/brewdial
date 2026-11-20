# shellcheck shell=bash
# shellcheck disable=SC2016 # SQL identifiers in backticks sit in single quotes on purpose.
# Per-table comparison of the restored copy with live. Sourced by
# verify-restore-heatwave.sh and by deploy/oci/test/restore-compare-test.sh, so the
# test runs the code the gate runs. The caller runs with pipefail and defines:
#   log <message>        prints one line
#   note_fail <message>  records one mismatch
#   q_live <sql>         read-only query on the live schema, batch output
#   q_restored <sql>     query on the restored copy, batch output
#   restored_load        reads SQL on stdin and runs it on the restored copy
# Logs carry table, column and row counts only. No value is ever printed. A failed
# scratch load is reported without MySQL's error text, which can echo a key value.

# A JSON number matches when |a - b| <= JSON_NUMBER_REL_TOLERANCE * max(|a|, |b|).
# Only numbers get this slack. Strings, booleans, null, keys and the shape of arrays
# and objects compare exactly. Reason: restoring a HeatWave 26.10 dump into MySQL 8.4
# moves some doubles by one ULP (e.g. 12.399999618530273 becomes 12.399999618530272).
# That is not data loss. 1e-12 is still thousands of ULPs at the magnitudes here.
JSON_NUMBER_REL_TOLERANCE=1e-12

# A number pair where either side has more than this many integer digits (so the value
# is at least 10^15, which covers every value outside +-2^53) compares by exact decimal
# value, not through DOUBLE. Two decimals are equal when their normalized digits and
# point positions are equal (see dec_update_sql).
JSON_EXACT_INTEGER_DIGITS=15

# Token pattern for JSON text as MySQL prints it: a string, a number, a literal or one
# punctuation mark. \x5c (backslash) and \x5b (open bracket) are used so that no
# backslash enters the SQL literal. The shell single quotes keep "\\x5c" as written,
# and the SQL literal turns "\\" into one backslash.
JSON_TOKEN_PATTERN='"(?:[^"\\x5c]|\\x5c.)*"|-?[0-9]+(?:[.][0-9]+)?(?:[eE][-+]?[0-9]+)?|true|false|null|[{}\\x5b\\x5d,:]'

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

# int_norm <sql expr>: SQL for an integer token in canonical form, so 007 and 7 match
# and -0 and 0 match. Digits stay a string, so no value is ever cast to a number.
int_norm() {
  local x="$1" d
  d="coalesce(nullif(trim(leading '0' from replace($x, '-', '')), ''), '0')"
  echo "concat(if($x like '-%' and $d <> '0', '-', ''), $d)"
}

# dec_update_sql: SQL that fills two columns of _jtok for every numeric token (a token
# that starts with a digit or a minus sign).
#   pos    the point position P, so that |value| = 0.D x 10^P with D the significant
#          digits (no leading or trailing zeros); 0 for zero.
#   canon  sign, P and D as text ('+16:9007199254740992'); two tokens have the same
#          canon exactly when they are the same decimal value. 0 is '0'.
# The digits stay text. The only cast is the exponent, a small integer.
dec_update_sql() {
  local u="if(left(tok, 1) = '-', substring(tok, 2), tok)"
  local lu="lower($u)"
  local m="substring_index($lu, 'e', 1)"
  local e="if(locate('e', $lu) > 0, cast(substring_index($lu, 'e', -1) as signed), 0)"
  local ip="substring_index($m, '.', 1)"
  local fp="if(locate('.', $m) > 0, substring_index($m, '.', -1), '')"
  local d0="concat($ip, $fp)"
  local d2="trim(trailing '0' from trim(leading '0' from $d0))"
  local p="(char_length($ip) + $e - (char_length($d0) - char_length(trim(leading '0' from $d0))))"
  echo "update \`_jtok\` set pos = if($d2 = '', 0, $p), canon = if($d2 = '', '0', concat(if(left(tok, 1) = '-', '-', '+'), $p, ':', $d2)) where tok regexp '^-?[0-9]';"
}

# compare_json_columns <table> <json column names, one per line>
#
# Scratch tables on the restored server (regular tables, so they outlive the separate
# sessions used below; dropped at the end). Keys are byte-exact varbinary: a text
# collation pads or folds, and two valid ids can differ only in trailing spaces.
#   _jkey  one row per (side, row key). side 1 = live, 2 = restored
#   _jsrc  one row per (side, JSON column, row key) with the JSON text. NULL is no row
#   _jtok  the tokens of each _jsrc text, in order (seq), from JSON_TOKEN_PATTERN;
#          pos and canon for numeric tokens (see dec_update_sql)
compare_json_columns() {
  local table="$1" json_cols="$2" pk_cols first_pk="" key_live="" key_restored=""
  local n=0 i=0 c select_live sql out label count idx col rows=0 tol pat tok_eq rk_restored

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
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    n=$((n + 1))
  done <<<"$json_cols"
  rk_restored="cast(concat_ws(char(31 using utf8mb4)$key_restored) as binary)"

  # 1. Scratch tables, created fresh.
  {
    printf 'drop table if exists `_jtok`, `_jsrc`, `_jkey`;\n'
    printf 'create table `_jkey` (src tinyint not null, rk varbinary(512) not null, primary key (src, rk));\n'
    printf 'create table `_jsrc` (src tinyint not null, col smallint not null, rk varbinary(512) not null, txt longtext character set utf8mb4 collate utf8mb4_bin not null, primary key (src, col, rk));\n'
    printf 'create table `_jtok` (src tinyint not null, col smallint not null, rk varbinary(512) not null, seq int not null, tok longtext character set utf8mb4 collate utf8mb4_bin not null, pos int, canon longtext character set utf8mb4 collate utf8mb4_bin, primary key (src, col, rk, seq));\n'
  } | restored_load 2>/dev/null || { note_fail "$table: scratch tables could not be created (MySQL error text withheld)"; return 0; }

  # 2. Live side, read-only: one row per live row, the key then one token per JSON column.
  #    Each value is hex, so no tab, newline or quote reaches the SQL text. The key may
  #    be empty, so the fields are split on tabs only, and the field count is checked.
  select_live="select hex(concat_ws(char(31 using utf8mb4)$key_live))"
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    select_live="$select_live, coalesce(concat('v', hex(cast(\`$c\` as char))), 'n')"
  done <<<"$json_cols"
  select_live="$select_live from \`$table\`"

  if ! q_live "$select_live" | awk -v n="$n" '
    BEGIN { FS = "\t" }
    NF == 0 { next }
    NF != n + 1 { exit 3 }
    {
      key = "unhex(\047" $1 "\047)"
      printf "insert into `_jkey` values (1, %s);\n", key
      for (i = 2; i <= n + 1; i++) {
        if ($i == "n") continue
        printf "insert into `_jsrc` values (1, %d, %s, convert(unhex(\047%s\047) using utf8mb4));\n", i - 1, key, substr($i, 2)
      }
    }' | restored_load 2>/dev/null; then
    note_fail "$table: the live rows could not be loaded into the scratch tables (error text withheld)"
    return 0
  fi

  # 3. Restored side: the same keys and the same JSON columns, as the server prints them.
  {
    printf 'insert into `_jkey` select 2, %s from `%s` r;\n' "$rk_restored" "$table"
    i=0
    while IFS= read -r c; do
      [ -n "$c" ] || continue
      i=$((i + 1))
      printf 'insert into `_jsrc` select 2, %d, %s, cast(r.`%s` as char) from `%s` r where r.`%s` is not null;\n' \
        "$i" "$rk_restored" "$c" "$table" "$c"
    done <<<"$json_cols"
  } | restored_load 2>/dev/null || { note_fail "$table: the restored rows could not be loaded into the scratch tables (error text withheld)"; return 0; }

  # 4. Tokenize every _jsrc text. A walk row is (token number, search position); each
  #    step finds the next token at or after the position and moves past it. The
  #    position after the last token is length + 1, and MySQL's regex functions reject
  #    a start beyond the end, so each call is guarded by a CASE on the position.
  #    The recursion limit is raised because a long curve has thousands of tokens.
  pat="$JSON_TOKEN_PATTERN"
  {
    printf 'set session cte_max_recursion_depth = 10000000;\n'
    printf 'insert into `_jtok` (src, col, rk, seq, tok) with recursive walk (src, col, rk, seq, p) as (\n'
    printf "  select s.src, s.col, s.rk, 1, 1 from \`_jsrc\` s where regexp_instr(s.txt, '%s', 1) > 0\n" "$pat"
    printf "  union all\n"
    printf "  select w.src, w.col, w.rk, w.seq + 1, regexp_instr(s.txt, '%s', w.p) + char_length(regexp_substr(s.txt, '%s', w.p))\n" "$pat" "$pat"
    printf "  from walk w join \`_jsrc\` s on s.src = w.src and s.col = w.col and s.rk = w.rk\n"
    printf "  where case when w.p <= char_length(s.txt) then regexp_instr(s.txt, '%s', w.p) else 0 end > 0\n" "$pat"
    printf ")\n"
    printf "select w.src, w.col, w.rk, w.seq, regexp_substr(s.txt, '%s', w.p) from walk w join \`_jsrc\` s on s.src = w.src and s.col = w.col and s.rk = w.rk\n" "$pat"
    printf "  where case when w.p <= char_length(s.txt) then regexp_instr(s.txt, '%s', w.p) else 0 end > 0;\n" "$pat"
    dec_update_sql
  } | restored_load 2>/dev/null || { note_fail "$table: the JSON tokens could not be built (error text withheld)"; return 0; }

  # 5. Counts only. A JSON value differs when its token count differs, or when a token
  #    pair differs. Two integer tokens (no point or exponent) compare exactly, as
  #    normalized strings, because a DOUBLE cast loses digits above 2^53. A number pair
  #    with more than JSON_EXACT_INTEGER_DIGITS integer digits on either side compares
  #    by exact decimal value (canon). Any other number pair compares within the
  #    tolerance. Everything else compares exactly.
  tol="$JSON_NUMBER_REL_TOLERANCE"
  tok_eq="case when a.tok regexp '^-?[0-9]+\$' and b.tok regexp '^-?[0-9]+\$' then $(int_norm a.tok) = $(int_norm b.tok) when a.tok regexp '^-?[0-9]' and b.tok regexp '^-?[0-9]' and greatest(a.pos, b.pos) > $JSON_EXACT_INTEGER_DIGITS then a.canon = b.canon when a.tok regexp '^-?[0-9]' and b.tok regexp '^-?[0-9]' then abs(cast(a.tok as double) - cast(b.tok as double)) <= $tol * greatest(abs(cast(a.tok as double)), abs(cast(b.tok as double))) else a.tok = b.tok end"
  sql="select 'rows', count(*) from \`_jkey\` where src = 1
    union all select 'live_row_missing', count(*) from \`_jkey\` l where l.src = 1 and not exists (select 1 from \`_jkey\` r where r.src = 2 and r.rk = l.rk)
    union all select 'restored_row_extra', count(*) from \`_jkey\` r where r.src = 2 and not exists (select 1 from \`_jkey\` l where l.src = 1 and l.rk = r.rk)"
  i=0
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    i=$((i + 1))
    sql="$sql
    union all select 'json:$i', count(*) from \`_jkey\` k where k.src = 1 and exists (select 1 from \`_jkey\` k2 where k2.src = 2 and k2.rk = k.rk) and not (
      (select count(*) from \`_jtok\` a where a.src = 1 and a.col = $i and a.rk = k.rk) = (select count(*) from \`_jtok\` b where b.src = 2 and b.col = $i and b.rk = k.rk)
      and not exists (select 1 from \`_jtok\` a join \`_jtok\` b on b.col = a.col and b.rk = a.rk and b.seq = a.seq
        where a.src = 1 and b.src = 2 and a.col = $i and a.rk = k.rk and not ($tok_eq)))"
  done <<<"$json_cols"

  out="$(q_restored "$sql")"
  q_restored 'drop table if exists `_jtok`, `_jsrc`, `_jkey`' >/dev/null

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
  log "  json $table ($rows rows, $n JSON column(s) compared by value, numbers within $tol)"
}
