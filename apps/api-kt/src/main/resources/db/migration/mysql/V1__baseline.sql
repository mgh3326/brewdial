-- MySQL 8.4 baseline equivalent to db/migration/postgresql/V1__baseline.sql
-- (packages/db/migrations 001..007). Same tables, columns, keys, CHECKs and
-- trigger behaviour; the vendor mapping is documented in
-- apps/api-kt/src/main/resources/db/migration/README.md.
--
-- Rules that keep the meaning identical to PostgreSQL:
--   * every table uses utf8mb4_0900_as_cs: comparisons are case- and
--     accent-sensitive like PostgreSQL text, so lower(...) keys mean the same;
--   * timestamps are DATETIME(6) holding UTC (the app pins the session time
--     zone to UTC; defaults and triggers use UTC_TIMESTAMP(6));
--   * text[] columns are JSON arrays (CHECK json_type = 'ARRAY');
--   * PostgreSQL functions that only the database used are inlined into
--     triggers; resolve_app_user lives in the application
--     (MySqlIdentityResolver), merge_app_users is not ported (no caller).

-- Database default collation: trigger variables and future tables inherit it,
-- so comparisons never mix accent-insensitive and accent-sensitive text.
alter database character set utf8mb4 collate utf8mb4_0900_as_cs;

-- ── recipe_code_seq (PostgreSQL sequence) ────────────────────────────────────
-- One row; `value` is the last code number handed out (setval(n, true) == value n).
create table recipe_code_seq (
  id    tinyint not null primary key,
  value bigint  not null,
  constraint recipe_code_seq_single_row check (id = 1)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;
insert into recipe_code_seq (id, value) values (1, 0);

-- ── app_users ────────────────────────────────────────────────────────────────
create table app_users (
  id           char(36)    not null default (uuid()) primary key,
  auth_user_id char(36),
  display_name text,
  created_at   datetime(6) not null default (utc_timestamp(6)),
  updated_at   datetime(6) not null default (utc_timestamp(6)),
  -- PostgreSQL: unique index ... where auth_user_id is not null. MySQL unique
  -- indexes already allow many NULLs, so a plain unique key means the same.
  unique key app_users_auth_user_id_uidx (auth_user_id),
  constraint app_users_display_name_len check (display_name is null or char_length(display_name) <= 80)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── beans ────────────────────────────────────────────────────────────────────
create table beans (
  id                varchar(128) not null default (uuid()) primary key,
  name              varchar(255) not null,
  roaster           varchar(255),
  origin            text,
  process           text,
  roast_level       text,
  notes             text,
  created_at        datetime(6) not null default (utc_timestamp(6)),
  updated_at        datetime(6) not null default (utc_timestamp(6)),
  roast_level_ord   smallint,
  agtron_min        int,
  agtron_max        int,
  acidity           smallint,
  body              smallint,
  decaf             boolean,
  flavor_categories json,
  attrs_source      text,
  source_url        text,
  attrs_notes       text,
  unique key beans_name_roaster_key ((lower(name)), (coalesce(lower(roaster), ''))),
  constraint beans_roast_level_ord_chk check (roast_level_ord is null or roast_level_ord between 1 and 5),
  constraint beans_acidity_chk check (acidity is null or acidity between 1 and 5),
  constraint beans_body_chk check (body is null or body between 1 and 5),
  constraint beans_agtron_chk check (
    (agtron_min is null or agtron_min between 0 and 150)
    and (agtron_max is null or agtron_max between 0 and 150)
    and (agtron_min is null or agtron_max is null or agtron_max >= agtron_min)
  ),
  constraint beans_flavor_categories_chk check (
    flavor_categories is null
    or (json_type(flavor_categories) = 'ARRAY'
        and json_contains(
          json_array('fruity','floral','sweet','nutty_cocoa','spices','roasted','cereal','sour_fermented','green'),
          flavor_categories))
  ),
  constraint beans_attrs_source_chk check (attrs_source is null or attrs_source in ('roaster_page','ai_extracted','manual'))
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── recipes ──────────────────────────────────────────────────────────────────
create table recipes (
  id                       char(36)     not null default (uuid()) primary key,
  -- Assigned by recipes_before_insert from recipe_code_seq when omitted.
  code                     varchar(64)  not null,
  method                   text         not null,
  title                    text         not null,
  version                  int          not null default 1,
  params                   json         not null default (json_object()),
  steps                    json         not null default (json_array()),
  bean_id                  varchar(128),
  bean_snapshot            json,
  intent                   json,
  notes                    text,
  adjustment_from_previous text,
  created_by               varchar(16)  not null default 'manual',
  status                   varchar(32)  not null default 'active',
  supersedes               text,
  superseded_by            text,
  parent_code              text,
  created_at               datetime(6)  not null default (utc_timestamp(6)),
  updated_at               datetime(6)  not null default (utc_timestamp(6)),
  owner_id                 char(36),
  is_official              boolean      not null default false,
  dripper_portability      json,
  unique key recipes_code_key (code),
  key recipes_status_created_at_idx (status, created_at desc),
  -- PostgreSQL partial indexes (where is_official and status = 'active' /
  -- where owner_id is not null) become plain indexes: same lookups, no
  -- uniqueness involved.
  key recipes_official_active_idx (is_official, status, created_at desc),
  key recipes_owner_idx (owner_id, status, created_at desc),
  constraint recipes_bean_id_fkey foreign key (bean_id) references beans (id) on delete set null,
  constraint recipes_owner_id_fkey foreign key (owner_id) references app_users (id) on delete set null,
  constraint recipes_method_check check (method in ('v60','espresso','aeropress','kalita','other')),
  constraint recipes_created_by_check check (created_by in ('agent','manual')),
  constraint recipes_status_check check (status in ('active','superseded','archived','test','reference')),
  constraint recipes_title_len check (char_length(title) <= 200),
  constraint recipes_notes_len check (notes is null or char_length(notes) <= 4000),
  constraint recipes_intent_is_array check (intent is null or json_type(intent) = 'ARRAY'),
  constraint recipes_dripper_portability_obj check (
    dripper_portability is null
    or (json_type(dripper_portability) = 'OBJECT'
        and char_length(cast(dripper_portability as char)) <= 8192)
  ),
  constraint recipes_grind_shape check (
    json_extract(params, '$.grind') is null
    or json_type(json_extract(params, '$.grind')) in ('STRING','OBJECT')
  )
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── feedback ─────────────────────────────────────────────────────────────────
create table feedback (
  id                char(36)     not null default (uuid()) primary key,
  recipe_code       varchar(64)  not null,
  bean_id           varchar(128),
  ratings           json,
  actual            json,
  comment           text,
  raw_comment       text,
  quick_tags        json,
  desired_direction json,
  next_hint         json,
  source            varchar(32)  not null default 'web',
  created_at        datetime(6)  not null default (utc_timestamp(6)),
  updated_at        datetime(6)  not null default (utc_timestamp(6)),
  owner_id          char(36),
  key feedback_recipe_code_idx (recipe_code, created_at desc),
  key feedback_owner_idx (owner_id),
  key feedback_bean_id_idx (bean_id),
  constraint feedback_recipe_code_fkey foreign key (recipe_code) references recipes (code) on delete cascade,
  constraint feedback_owner_id_fkey foreign key (owner_id) references app_users (id) on delete set null,
  constraint feedback_bean_id_fkey foreign key (bean_id) references beans (id) on delete set null,
  constraint feedback_source_check check (source in ('web','coffee_profile','api','agent','mcp')),
  constraint feedback_comment_len check (comment is null or char_length(comment) <= 2000),
  constraint feedback_raw_comment_len check (raw_comment is null or char_length(raw_comment) <= 2000),
  -- array_length(quick_tags, 1) <= 20 (NULL for an empty array, so [] passes).
  constraint feedback_quick_tags_len check (
    quick_tags is null or (json_type(quick_tags) = 'ARRAY' and json_length(quick_tags) <= 20)
  ),
  constraint feedback_desired_direction_is_array check (desired_direction is null or json_type(desired_direction) = 'ARRAY'),
  constraint feedback_next_hint_is_array check (next_hint is null or json_type(next_hint) = 'ARRAY')
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── preferences (single global row) ──────────────────────────────────────────
create table preferences (
  id             varchar(64) not null default 'global' primary key,
  likes          json        not null default (json_array()),
  dislikes       json        not null default (json_array()),
  default_params json        not null default (json_object()),
  created_at     datetime(6) not null default (utc_timestamp(6)),
  updated_at     datetime(6) not null default (utc_timestamp(6)),
  constraint preferences_likes_is_array check (json_type(likes) = 'ARRAY'),
  constraint preferences_dislikes_is_array check (json_type(dislikes) = 'ARRAY')
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── bd_migration_meta ────────────────────────────────────────────────────────
create table bd_migration_meta (
  `key`      varchar(128) not null primary key,
  value      text,
  created_at datetime(6)  not null default (utc_timestamp(6))
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;
insert into bd_migration_meta (`key`, value)
  values ('phase0_cutoff', date_format(utc_timestamp(6), '%Y-%m-%d %H:%i:%s.%f+00'));

-- ── user_identities ──────────────────────────────────────────────────────────
create table user_identities (
  id           char(36)     not null default (uuid()) primary key,
  app_user_id  char(36)     not null,
  provider     varchar(32)  not null,
  external_key varchar(256) not null,
  verified     boolean      not null default false,
  created_at   datetime(6)  not null default (utc_timestamp(6)),
  updated_at   datetime(6)  not null default (utc_timestamp(6)),
  unique key user_identities_provider_external_key_key (provider, external_key),
  key user_identities_app_user_idx (app_user_id),
  constraint user_identities_app_user_id_fkey foreign key (app_user_id) references app_users (id) on delete cascade,
  constraint user_identities_provider_check check (provider in ('toss_anon','web_local','toss_login')),
  constraint user_identities_external_key_len check (char_length(external_key) between 16 and 256),
  constraint user_identities_verified_provider_chk check (verified = false or provider = 'toss_login')
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── grinders (SHARED registry) ───────────────────────────────────────────────
create table grinders (
  id                  char(36)       not null default (uuid()) primary key,
  name                varchar(120)   not null,
  um_per_click_est    decimal(38,10),
  um_per_click_source text,
  zero_ref            text,
  stepless            boolean        not null default false,
  brew_method_ranges  json           not null default (json_object()),
  anchor_point        json,
  notes               text,
  created_at          datetime(6)    not null default (utc_timestamp(6)),
  updated_at          datetime(6)    not null default (utc_timestamp(6)),
  unique key grinders_name_uidx ((lower(name))),
  constraint grinders_um_per_click_source_check check (um_per_click_source in ('measured','estimated','unknown')),
  constraint grinders_name_len check (char_length(name) <= 120),
  constraint grinders_notes_len check (notes is null or char_length(notes) <= 2000)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── drippers (SHARED registry) ───────────────────────────────────────────────
create table drippers (
  id                     char(36)       not null default (uuid()) primary key,
  name                   varchar(120)   not null,
  class                  text           not null,
  geometry               text,
  continuum_position     decimal(38,10),
  hole_spec              json           not null default (json_object()),
  filter_type            text,
  recommended_dose_range json           not null default (json_object()),
  size_models            json           not null default (json_array()),
  notes                  text,
  created_at             datetime(6)    not null default (utc_timestamp(6)),
  updated_at             datetime(6)    not null default (utc_timestamp(6)),
  unique key drippers_name_uidx ((lower(name))),
  constraint drippers_class_check check (class in ('bed_restricted','dripper_restricted','hybrid','immersion')),
  constraint drippers_geometry_check check (geometry in ('cone','flat','wedge','basket')),
  constraint drippers_continuum_position_check check (continuum_position is null or (continuum_position between 0 and 1)),
  constraint drippers_name_len check (char_length(name) <= 120),
  constraint drippers_notes_len check (notes is null or char_length(notes) <= 2000)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── user_gear ────────────────────────────────────────────────────────────────
create table user_gear (
  id          char(36)     not null default (uuid()) primary key,
  app_user_id char(36)     not null,
  kind        varchar(16)  not null,
  grinder_id  char(36),
  dripper_id  char(36),
  label       varchar(120) not null,
  details     json         not null default (json_object()),
  is_default  boolean      not null default false,
  created_at  datetime(6)  not null default (utc_timestamp(6)),
  updated_at  datetime(6)  not null default (utc_timestamp(6)),
  key user_gear_app_user_idx (app_user_id, kind),
  -- PostgreSQL: unique (app_user_id, kind) where is_default. Non-default rows
  -- index as (NULL, NULL), which never collide.
  unique key user_gear_one_default_uidx (
    (case when is_default then app_user_id end),
    (case when is_default then kind end)
  ),
  constraint user_gear_app_user_id_fkey foreign key (app_user_id) references app_users (id) on delete cascade,
  constraint user_gear_grinder_id_fkey foreign key (grinder_id) references grinders (id) on delete set null,
  constraint user_gear_dripper_id_fkey foreign key (dripper_id) references drippers (id) on delete set null,
  constraint user_gear_kind_check check (kind in ('grinder','dripper')),
  constraint user_gear_label_len check (char_length(label) between 1 and 120),
  constraint user_gear_details_size check (char_length(cast(details as char)) <= 4096)
  -- user_gear_kind_ref_chk is enforced by triggers: MySQL refuses a CHECK on
  -- columns that carry an ON DELETE SET NULL foreign key.
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── grinder_calibration ──────────────────────────────────────────────────────
create table grinder_calibration (
  id              char(36)     not null default (uuid()) primary key,
  app_user_id     char(36)     not null,
  from_grinder_id char(36),
  to_grinder_id   char(36),
  from_label      varchar(255) not null,
  to_label        varchar(255) not null,
  anchor_method   varchar(120),
  samples         json         not null default (json_array()),
  source          varchar(32)  not null default 'measured',
  notes           text,
  created_at      datetime(6)  not null default (utc_timestamp(6)),
  updated_at      datetime(6)  not null default (utc_timestamp(6)),
  key grinder_calibration_user_idx (app_user_id),
  unique key grinder_calibration_pair_uidx (
    app_user_id,
    (coalesce(from_grinder_id, lower(from_label))),
    (coalesce(to_grinder_id, lower(to_label))),
    (coalesce(anchor_method, ''))
  ),
  constraint grinder_calibration_app_user_id_fkey foreign key (app_user_id) references app_users (id) on delete cascade,
  constraint grinder_calibration_from_grinder_id_fkey foreign key (from_grinder_id) references grinders (id) on delete set null,
  constraint grinder_calibration_to_grinder_id_fkey foreign key (to_grinder_id) references grinders (id) on delete set null,
  constraint grinder_calibration_source_check check (source in ('measured','dial-in-start')),
  constraint grinder_calibration_notes_len check (notes is null or char_length(notes) <= 1000),
  constraint grinder_calibration_samples_size check (char_length(cast(samples as char)) <= 4096)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── saved_recipes ────────────────────────────────────────────────────────────
create table saved_recipes (
  id          char(36)    not null default (uuid()) primary key,
  app_user_id char(36)    not null,
  recipe_code varchar(64) not null,
  snapshot    json,
  note        text,
  created_at  datetime(6) not null default (utc_timestamp(6)),
  unique key saved_recipes_app_user_id_recipe_code_key (app_user_id, recipe_code),
  key saved_recipes_user_idx (app_user_id, created_at desc),
  constraint saved_recipes_app_user_id_fkey foreign key (app_user_id) references app_users (id) on delete cascade,
  constraint saved_recipes_note_len check (note is null or char_length(note) <= 1000),
  constraint saved_recipes_snapshot_size check (snapshot is null or char_length(cast(snapshot as char)) <= 16384)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── saved_beans ──────────────────────────────────────────────────────────────
create table saved_beans (
  id          char(36)     not null default (uuid()) primary key,
  app_user_id char(36)     not null,
  bean_id     varchar(128) not null,
  note        text,
  created_at  datetime(6)  not null default (utc_timestamp(6)),
  unique key saved_beans_app_user_id_bean_id_key (app_user_id, bean_id),
  key saved_beans_user_idx (app_user_id, created_at desc),
  constraint saved_beans_app_user_id_fkey foreign key (app_user_id) references app_users (id) on delete cascade,
  constraint saved_beans_bean_id_fkey foreign key (bean_id) references beans (id) on delete cascade,
  constraint saved_beans_note_len check (note is null or char_length(note) <= 1000)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── bean_photos (forward-compat) ─────────────────────────────────────────────
create table bean_photos (
  id          char(36)     not null default (uuid()) primary key,
  bean_id     varchar(128) not null,
  app_user_id char(36),
  url         text         not null,
  source      text,
  attribution text,
  sort_order  int          not null default 0,
  created_at  datetime(6)  not null default (utc_timestamp(6)),
  updated_at  datetime(6)  not null default (utc_timestamp(6)),
  key bean_photos_bean_idx (bean_id, sort_order),
  constraint bean_photos_bean_id_fkey foreign key (bean_id) references beans (id) on delete cascade,
  constraint bean_photos_app_user_id_fkey foreign key (app_user_id) references app_users (id) on delete set null,
  constraint bean_photos_url_https check (char_length(url) <= 2048 and regexp_like(url, '^https://', 'c'))
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── bean_purchase_links (forward-compat) ─────────────────────────────────────
create table bean_purchase_links (
  id            char(36)     not null default (uuid()) primary key,
  bean_id       varchar(128) not null,
  vendor        text         not null,
  url           text         not null,
  link_category varchar(32)  not null default 'product',
  price_krw     int,
  is_affiliate  boolean      not null default false,
  active        boolean      not null default true,
  sort_order    int          not null default 0,
  created_at    datetime(6)  not null default (utc_timestamp(6)),
  updated_at    datetime(6)  not null default (utc_timestamp(6)),
  -- PostgreSQL: (bean_id, sort_order) where active.
  key bean_purchase_links_bean_idx (bean_id, active, sort_order),
  constraint bean_purchase_links_bean_id_fkey foreign key (bean_id) references beans (id) on delete cascade,
  constraint bean_purchase_links_link_category_check check (link_category in ('product','lowest_price','coupon','generic')),
  constraint bean_purchase_links_url_https check (char_length(url) <= 2048 and regexp_like(url, '^https://', 'c')),
  constraint bean_purchase_links_vendor_len check (char_length(vendor) <= 60)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

-- ── bean_summaries view ──────────────────────────────────────────────────────
-- count/max/bool_or ... filter (where ...) become conditional aggregates.
-- has_ai is 0/1 here (MySQL has no boolean type); the app reads it as a boolean.
create sql security invoker view bean_summaries as
  select b.id, b.name, b.roaster, b.origin, b.process, b.roast_level, b.notes,
         count(case when r.status = 'active' and r.owner_id is null then r.code end) as recipe_count,
         max(case when r.status = 'active' and r.owner_id is null then r.created_at end) as latest_recipe_at,
         coalesce(max(case when r.status = 'active' and r.owner_id is null then r.created_by = 'agent' end), false) as has_ai,
         b.roast_level_ord, b.agtron_min, b.agtron_max, b.acidity, b.body,
         b.decaf, b.flavor_categories, b.attrs_source, b.source_url, b.attrs_notes
  from beans b
  left join recipes r on r.bean_id = b.id
  group by b.id;

-- ── triggers ─────────────────────────────────────────────────────────────────
-- @bd_owner_write_ok is the session flag that PostgreSQL keeps in the
-- transaction-local setting bd.owner_write_ok. The app sets it right before an
-- owner/agent write and clears it right after (VendorSql.withOwnerWrites).
--
-- @bd_replication_role = 'replica' is the MySQL stand-in for PostgreSQL
-- session_replication_role = replica: the data copy (DatabaseCopyRunner) loads
-- rows exactly as they are, so the BEFORE INSERT logic is skipped.

DELIMITER $$

-- recipes BEFORE INSERT = PostgreSQL recipes_guard_owner_immutable (INSERT
-- branch) → code default (nextval) → recipes_link_bean, in that order (the
-- PostgreSQL triggers fire in name order: guard before link).
create trigger recipes_before_insert before insert on recipes
for each row
begin
  declare v_next bigint;
  declare v_name varchar(255);
  declare v_roaster varchar(255);
  declare v_origin text;
  declare v_process text;
  declare v_roast_level text;
  declare v_notes text;
  declare v_bean_id varchar(128);

  if coalesce(@bd_replication_role, '') <> 'replica' then
  if coalesce(@bd_owner_write_ok, '') <> 'on' then
    set new.owner_id = null;
    set new.is_official = false;
    set new.created_by = 'manual';
  end if;

  if new.code is null or new.code = '' then
    select value + 1 into v_next from recipe_code_seq where id = 1 for update;
    update recipe_code_seq set value = v_next where id = 1;
    -- lpad truncates past 4 digits exactly like PostgreSQL lpad.
    set new.code = concat('COF-', lpad(v_next, 4, '0'));
  end if;

  if new.bean_id is null and new.bean_snapshot is not null then
    -- snap->>'k': SQL NULL for a missing key or JSON null.
    set v_name = nullif(trim(case when json_type(json_extract(new.bean_snapshot, '$.name')) = 'NULL' then null
                                  else json_unquote(json_extract(new.bean_snapshot, '$.name')) end), '');
    set v_roaster = nullif(trim(case when json_type(json_extract(new.bean_snapshot, '$.roaster')) = 'NULL' then null
                                     else json_unquote(json_extract(new.bean_snapshot, '$.roaster')) end), '');
    if v_name is not null then
      if new.owner_id is not null then
        -- find_bean_match: link to an existing bean only.
        select id into v_bean_id from beans
          where lower(name) = lower(v_name)
            and coalesce(lower(roaster), '') = coalesce(lower(v_roaster), '')
          limit 1;
      else
        -- find_or_create_bean: insert, or enrich the existing bean.
        set v_origin = case when json_type(json_extract(new.bean_snapshot, '$.origin')) = 'NULL' then null
                            else json_unquote(json_extract(new.bean_snapshot, '$.origin')) end;
        set v_process = case when json_type(json_extract(new.bean_snapshot, '$.process')) = 'NULL' then null
                             else json_unquote(json_extract(new.bean_snapshot, '$.process')) end;
        set v_roast_level = case when json_type(json_extract(new.bean_snapshot, '$.roastLevel')) = 'NULL' then null
                                 else json_unquote(json_extract(new.bean_snapshot, '$.roastLevel')) end;
        set v_notes = case when json_type(json_extract(new.bean_snapshot, '$.notes')) = 'NULL' then null
                           else json_unquote(json_extract(new.bean_snapshot, '$.notes')) end;
        insert into beans (id, name, roaster, origin, process, roast_level, notes)
          values (uuid(), v_name, v_roaster, v_origin, v_process, v_roast_level, v_notes) as incoming
          on duplicate key update
            origin      = coalesce(incoming.origin, beans.origin),
            process     = coalesce(incoming.process, beans.process),
            roast_level = coalesce(incoming.roast_level, beans.roast_level),
            notes       = coalesce(incoming.notes, beans.notes),
            updated_at  = utc_timestamp(6);
        select id into v_bean_id from beans
          where lower(name) = lower(v_name)
            and coalesce(lower(roaster), '') = coalesce(lower(v_roaster), '')
          limit 1;
      end if;
      set new.bean_id = v_bean_id;
    end if;
  end if;
  end if;
end$$

-- recipes BEFORE UPDATE = recipes_guard_owner_immutable (UPDATE branch) + set_updated_at.
create trigger recipes_before_update before update on recipes
for each row
begin
  if coalesce(@bd_owner_write_ok, '') <> 'on' then
    if not (new.owner_id <=> old.owner_id) then
      signal sqlstate 'P0001' set message_text = 'owner_id is immutable for non-owner-writer sessions';
    end if;
    if not (new.is_official <=> old.is_official) then
      signal sqlstate 'P0001' set message_text = 'is_official is immutable for non-owner-writer sessions';
    end if;
    if not (new.created_by <=> old.created_by) then
      signal sqlstate 'P0001' set message_text = 'created_by is immutable for non-owner-writer sessions';
    end if;
  end if;
  set new.updated_at = utc_timestamp(6);
end$$

-- feedback BEFORE INSERT = feedback_link_bean.
create trigger feedback_before_insert before insert on feedback
for each row
begin
  if coalesce(@bd_replication_role, '') <> 'replica' and new.bean_id is null then
    set new.bean_id = (
      select r.bean_id from recipes r
       where r.code = new.recipe_code
         and r.bean_id is not null
         and exists (select 1 from beans b where b.id = r.bean_id)
       limit 1);
  end if;
end$$

create trigger feedback_before_update before update on feedback
for each row set new.updated_at = utc_timestamp(6)$$

-- user_gear: user_gear_kind_ref_chk + set_updated_at.
create trigger user_gear_before_insert before insert on user_gear
for each row
begin
  if not ((new.kind = 'grinder' and new.dripper_id is null) or (new.kind = 'dripper' and new.grinder_id is null)) then
    signal sqlstate '23514' set message_text = 'new row for relation "user_gear" violates check constraint "user_gear_kind_ref_chk"';
  end if;
end$$

create trigger user_gear_before_update before update on user_gear
for each row
begin
  if not ((new.kind = 'grinder' and new.dripper_id is null) or (new.kind = 'dripper' and new.grinder_id is null)) then
    signal sqlstate '23514' set message_text = 'new row for relation "user_gear" violates check constraint "user_gear_kind_ref_chk"';
  end if;
  set new.updated_at = utc_timestamp(6);
end$$

create trigger preferences_before_update before update on preferences
for each row set new.updated_at = utc_timestamp(6)$$

create trigger beans_before_update before update on beans
for each row set new.updated_at = utc_timestamp(6)$$

create trigger app_users_before_update before update on app_users
for each row set new.updated_at = utc_timestamp(6)$$

create trigger user_identities_before_update before update on user_identities
for each row set new.updated_at = utc_timestamp(6)$$

create trigger grinders_before_update before update on grinders
for each row set new.updated_at = utc_timestamp(6)$$

create trigger drippers_before_update before update on drippers
for each row set new.updated_at = utc_timestamp(6)$$

create trigger grinder_calibration_before_update before update on grinder_calibration
for each row set new.updated_at = utc_timestamp(6)$$

create trigger bean_photos_before_update before update on bean_photos
for each row set new.updated_at = utc_timestamp(6)$$

create trigger bean_purchase_links_before_update before update on bean_purchase_links
for each row set new.updated_at = utc_timestamp(6)$$

DELIMITER ;
