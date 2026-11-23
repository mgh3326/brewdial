-- Corrects pre-fix brew snapshots: a pour stored as "ring" before the mapping fix came
-- from xBloom cloud pattern code 1 and is really "center".
--
-- Until PR #117 (merge c0d8459, deployed 2026-11-22 02:04Z) mapPattern read the cloud
-- codes as {0: center, 1: ring, 2: spiral}, but the cloud sends 1 = center, 2 = spiral,
-- 3 = ring. So every pour stored as "ring" before the fix came from code 1 and is really
-- "center"; code 3 (a real ring) threw and those brews were skipped, so no genuine ring
-- was stored before the fix. Rows inserted after the fix are already correct.
--
-- Cutoff: the last collector run under the old mapping inserted rows at 2026-11-20
-- 22:00Z and the first run under the fix at 2026-11-22 02:06Z, with nothing inserted in
-- between. Every row created before 2026-11-22 00:00:00 UTC is therefore pre-fix, and
-- rows created at or after it are untouched.
--
-- One-way data correction. There is no reverse migration: a row that holds "center"
-- now may have been genuinely center before the fix, so "ring" cannot be recovered from
-- it. Rollback means restoring `brews` from the nightly backup.
--
-- Idempotent and safe on a fresh database: the WHERE clause matches only pre-cutoff
-- rows that still hold a ring pattern, so a second run changes nothing and an empty
-- table is untouched. MySQL 8.4 and HeatWave (MySQL 26.10-cloud): standard JSON
-- functions and one UPDATE, no DDL and no stored procedures.

-- The rebuilt pours array is joined as text, so lift GROUP_CONCAT above its 1024-byte
-- default for this session.
set session group_concat_max_len = 1048576;

update brews
set recipe_snapshot = json_set(
      recipe_snapshot,
      '$.pours',
      json_extract(
        convert(
          concat(
            '[',
            (
              select group_concat(
                       if(
                         json_unquote(json_extract(p.pour, '$.pattern')) = 'ring',
                         json_replace(p.pour, '$.pattern', 'center'),
                         p.pour
                       )
                       order by p.ord
                       separator ','
                     )
              from json_table(
                     recipe_snapshot,
                     '$.pours[*]' columns (ord for ordinality, pour json path '$')
                   ) as p
            ),
            ']'
          )
          using utf8mb4
        ),
        '$'
      )
    )
where created_at < '2026-11-22 00:00:00'
  and json_search(recipe_snapshot, 'one', 'ring', null, '$.pours[*].pattern') is not null;
