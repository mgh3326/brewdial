# Flyway migrations per database vendor

`DATABASE_URL` picks the folder: `postgres://` → `postgresql/`, `mysql://` →
`mysql/` (see `DatabaseUrlEnvironmentPostProcessor`). Both folders must
describe the same schema. Every change lands as a `V<n>__<name>.sql` pair, one
per vendor, in the same PR.

- `postgresql/` is generated from `packages/db/migrations` (node-pg-migrate,
  the PostgreSQL source of truth for the Node API) with
  `scripts/gen-postgres-baseline.sh`. `PostgresBaselineDriftTest` fails if
  they disagree. A database that node-pg-migrate already migrated is
  baselined at V1 on first start (`baseline-on-migrate`, PostgreSQL only).
- `mysql/` is written by hand for MySQL 8.4.
- `SchemaContractTest` checks both vendors' migrated schemas against
  `src/test/resources/schema-contract.txt`: tables, views, columns and NOT
  NULL. `SchemaBehaviourTest` checks the trigger and constraint behaviour
  that both must share. CI runs both tests on both databases (`ci-kt.yml`).

## PostgreSQL → MySQL mapping (V1)

| PostgreSQL | MySQL | Note |
|---|---|---|
| `uuid` default `gen_random_uuid()` | `char(36)` default `(uuid())` | Hibernate binds UUIDs as CHAR on MySQL |
| `text` | `text`; `varchar(n)` when indexed | Caps: names 255, bean ids 128, codes 64 (runbook precheck) |
| `jsonb` | `json` | |
| `text[]` | `json` + CHECK `json_type = 'ARRAY'` | Read back as lists by `ApiRowMapper.textArray` |
| `timestamptz` default `now()` | `datetime(6)` default `(utc_timestamp(6))` | The session time zone is pinned to UTC |
| `numeric` | `decimal(38,10)` | Trailing zeros stripped on read |
| collation (case/accent-sensitive) | `utf8mb4_0900_as_cs` | `lower(...)` keys keep their meaning |
| sequence `recipe_code_seq` | table `recipe_code_seq` (one row) | Locked per insert; no gaps on rollback |
| partial unique index | functional unique key that indexes NULL for excluded rows | `user_gear_one_default_uidx` |
| partial non-unique index | plain index | Same lookups |
| expression unique index | functional key parts | `beans_name_roaster_key`, `grinder_calibration_pair_uidx` |
| CHECK `url ~ '^https://'` | CHECK `regexp_like(url, '^https://', 'c')` | |
| CHECK on a column with `ON DELETE SET NULL` | BEFORE INSERT/UPDATE trigger | `user_gear_kind_ref_chk` (MySQL refuses such CHECKs) |
| `set_updated_at` triggers | BEFORE UPDATE triggers | |
| `recipes_guard_owner_immutable`, `recipes_link_bean`, `find_or_create_bean`, `find_bean_match` | `recipes_before_insert` / `recipes_before_update` | The guard reads `@bd_owner_write_ok` (PostgreSQL: txn-local `bd.owner_write_ok`) |
| `feedback_link_bean` | `feedback_before_insert` | |
| view `bean_summaries` (`filter`, `bool_or`) | view with conditional aggregates | `has_ai` is 0/1 |
| `resolve_app_user` | `JdbcIdentityResolver` (application) | Unique key + one transaction instead of an advisory lock |
| `merge_app_users`, `set_recipe_code_seq` | not ported | No api-kt caller; the data copy sets `recipe_code_seq` |
| `session_replication_role = replica` | `@bd_replication_role = 'replica'` | Used only by the data copy |
