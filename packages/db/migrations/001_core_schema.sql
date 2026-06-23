-- Up Migration

create extension if not exists pgcrypto; -- gen_random_uuid()

-- Sequential recipe codes: COF-0001, COF-0002, ... (atomic, no retry loop)
create sequence if not exists recipe_code_seq start 1;

-- ── recipes ────────────────────────────────────────────────────────────────
create table if not exists recipes (
  id                       uuid primary key default gen_random_uuid(),
  code                     text unique not null
                             default ('COF-' || lpad(nextval('recipe_code_seq')::text, 4, '0')),
  method                   text not null check (method in ('v60','espresso','aeropress','kalita','other')),
  title                    text not null,
  version                  integer not null default 1,
  params                   jsonb not null default '{}'::jsonb,
  steps                    jsonb not null default '[]'::jsonb,
  bean_id                  text,
  bean_snapshot            jsonb,
  intent                   text[],
  notes                    text,
  adjustment_from_previous text,
  created_by               text not null default 'manual' check (created_by in ('agent','manual')),
  status                   text not null default 'active' check (status in ('active','superseded','archived','test')),
  supersedes               text,
  superseded_by            text,
  parent_code              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Idempotent upgrade columns (no-op on fresh table above)
alter table recipes add column if not exists status text not null default 'active';
alter table recipes add column if not exists supersedes text;
alter table recipes add column if not exists superseded_by text;
alter table recipes add column if not exists parent_code text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_status_check') then
    alter table recipes add constraint recipes_status_check
      check (status in ('active','superseded','archived','test'));
  end if;
end $$;

create index if not exists recipes_status_created_at_idx on recipes (status, created_at desc);

-- ── feedback ───────────────────────────────────────────────────────────────
create table if not exists feedback (
  id                uuid primary key default gen_random_uuid(),
  recipe_code       text not null references recipes(code) on delete cascade,
  bean_id           text,
  ratings           jsonb,
  actual            jsonb,
  comment           text,
  raw_comment       text,
  quick_tags        text[],
  desired_direction text[],
  next_hint         text[],
  source            text not null default 'web'
                      check (source in ('web','coffee_profile','api','agent','mcp')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists feedback_recipe_code_idx on feedback (recipe_code, created_at desc);

-- ── preferences (single global row) ──────────────────────────────────────────
create table if not exists preferences (
  id             text primary key default 'global',
  likes          text[] not null default '{}',
  dislikes       text[] not null default '{}',
  default_params jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── beans ─────────────────────────────────────────────────────────────────────
create table if not exists beans (
  id          text primary key default gen_random_uuid()::text,
  name        text not null,
  roaster     text,
  origin      text,
  process     text,
  roast_level text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists beans_name_roaster_key
  on beans (lower(name), coalesce(lower(roaster), ''));

-- recipes.bean_id FK to beans.id
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_bean_id_fkey') then
    alter table recipes add constraint recipes_bean_id_fkey
      foreign key (bean_id) references beans(id) on delete set null;
  end if;
end $$;

-- Abuse guardrails: length + array-size caps
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_title_len') then
    alter table recipes add constraint recipes_title_len check (char_length(title) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipes_notes_len') then
    alter table recipes add constraint recipes_notes_len
      check (notes is null or char_length(notes) <= 4000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_comment_len') then
    alter table feedback add constraint feedback_comment_len
      check (comment is null or char_length(comment) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_raw_comment_len') then
    alter table feedback add constraint feedback_raw_comment_len
      check (raw_comment is null or char_length(raw_comment) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_quick_tags_len') then
    alter table feedback add constraint feedback_quick_tags_len
      check (quick_tags is null or array_length(quick_tags, 1) <= 20);
  end if;
end $$;

-- ── bd_migration_meta ─────────────────────────────────────────────────────────
create table if not exists bd_migration_meta (
  key        text primary key,
  value      text,
  created_at timestamptz not null default now()
);
-- Captured exactly ONCE (first apply). Re-applying schema is idempotent.
insert into bd_migration_meta (key, value)
  values ('phase0_cutoff', now()::text)
  on conflict (key) do nothing;

-- ── app_users ─────────────────────────────────────────────────────────────────
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists app_users_auth_user_id_uidx
  on app_users (auth_user_id) where auth_user_id is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_users_display_name_len') then
    alter table app_users add constraint app_users_display_name_len
      check (display_name is null or char_length(display_name) <= 80);
  end if;
end $$;

-- ── user_identities ───────────────────────────────────────────────────────────
create table if not exists user_identities (
  id           uuid primary key default gen_random_uuid(),
  app_user_id  uuid not null references app_users(id) on delete cascade,
  provider     text not null check (provider in ('toss_anon','web_local','toss_login')),
  external_key text not null,
  verified     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (provider, external_key)
);
create index if not exists user_identities_app_user_idx on user_identities (app_user_id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_identities_external_key_len') then
    alter table user_identities add constraint user_identities_external_key_len
      check (char_length(external_key) between 16 and 256);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_identities_verified_provider_chk') then
    alter table user_identities add constraint user_identities_verified_provider_chk
      check (verified = false or provider = 'toss_login');
  end if;
end $$;

-- recipes ownership columns (app_users must exist before adding FK)
alter table recipes add column if not exists owner_id uuid;
alter table recipes add column if not exists is_official boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_owner_id_fkey') then
    alter table recipes add constraint recipes_owner_id_fkey
      foreign key (owner_id) references app_users(id) on delete set null;
  end if;
end $$;
create index if not exists recipes_official_active_idx
  on recipes (created_at desc) where is_official and status = 'active';
create index if not exists recipes_owner_idx
  on recipes (owner_id, status, created_at desc) where owner_id is not null;

-- feedback ownership column
alter table feedback add column if not exists owner_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_owner_id_fkey') then
    alter table feedback add constraint feedback_owner_id_fkey
      foreign key (owner_id) references app_users(id) on delete set null;
  end if;
end $$;
create index if not exists feedback_owner_idx on feedback (owner_id) where owner_id is not null;

-- recipes dripper_portability + grind shape constraints
alter table recipes add column if not exists dripper_portability jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_dripper_portability_obj') then
    alter table recipes add constraint recipes_dripper_portability_obj
      check (dripper_portability is null
             or (jsonb_typeof(dripper_portability) = 'object'
                 and char_length(dripper_portability::text) <= 8192));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipes_grind_shape') then
    alter table recipes add constraint recipes_grind_shape
      check (params->'grind' is null
             or jsonb_typeof(params->'grind') in ('string','object'));
  end if;
end $$;

-- ── grinders (SHARED registry) ────────────────────────────────────────────────
create table if not exists grinders (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  um_per_click_est    numeric,
  um_per_click_source text check (um_per_click_source in ('measured','estimated','unknown')),
  zero_ref            text,
  stepless            boolean not null default false,
  brew_method_ranges  jsonb not null default '{}'::jsonb,
  anchor_point        jsonb,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists grinders_name_uidx on grinders (lower(name));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'grinders_name_len') then
    alter table grinders add constraint grinders_name_len check (char_length(name) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grinders_notes_len') then
    alter table grinders add constraint grinders_notes_len
      check (notes is null or char_length(notes) <= 2000);
  end if;
end $$;

-- ── drippers (SHARED registry) ────────────────────────────────────────────────
create table if not exists drippers (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  class                  text not null check (class in ('bed_restricted','dripper_restricted','hybrid','immersion')),
  geometry               text check (geometry in ('cone','flat','wedge','basket')),
  continuum_position     numeric check (continuum_position is null or (continuum_position between 0 and 1)),
  hole_spec              jsonb not null default '{}'::jsonb,
  filter_type            text,
  recommended_dose_range jsonb not null default '{}'::jsonb,
  size_models            jsonb not null default '[]'::jsonb,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists drippers_name_uidx on drippers (lower(name));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'drippers_name_len') then
    alter table drippers add constraint drippers_name_len check (char_length(name) <= 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'drippers_notes_len') then
    alter table drippers add constraint drippers_notes_len
      check (notes is null or char_length(notes) <= 2000);
  end if;
end $$;

-- ── user_gear ─────────────────────────────────────────────────────────────────
create table if not exists user_gear (
  id           uuid primary key default gen_random_uuid(),
  app_user_id  uuid not null references app_users(id) on delete cascade,
  kind         text not null check (kind in ('grinder','dripper')),
  grinder_id   uuid references grinders(id) on delete set null,
  dripper_id   uuid references drippers(id) on delete set null,
  label        text not null,
  details      jsonb not null default '{}'::jsonb,
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists user_gear_app_user_idx on user_gear (app_user_id, kind);
create unique index if not exists user_gear_one_default_uidx
  on user_gear (app_user_id, kind) where is_default;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_gear_label_len') then
    alter table user_gear add constraint user_gear_label_len check (char_length(label) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_gear_kind_ref_chk') then
    alter table user_gear add constraint user_gear_kind_ref_chk check (
      (kind='grinder' and dripper_id is null) or (kind='dripper' and grinder_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_gear_details_size') then
    alter table user_gear add constraint user_gear_details_size
      check (char_length(details::text) <= 4096);
  end if;
end $$;

-- ── grinder_calibration ───────────────────────────────────────────────────────
create table if not exists grinder_calibration (
  id               uuid primary key default gen_random_uuid(),
  app_user_id      uuid not null references app_users(id) on delete cascade,
  from_grinder_id  uuid references grinders(id) on delete set null,
  to_grinder_id    uuid references grinders(id) on delete set null,
  from_label       text not null,
  to_label         text not null,
  anchor_method    text,
  samples          jsonb not null default '[]'::jsonb,
  source           text not null default 'measured' check (source in ('measured','dial-in-start')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists grinder_calibration_user_idx on grinder_calibration (app_user_id);
create unique index if not exists grinder_calibration_pair_uidx
  on grinder_calibration (
    app_user_id,
    coalesce(from_grinder_id::text, lower(from_label)),
    coalesce(to_grinder_id::text,   lower(to_label)),
    coalesce(anchor_method, '')
  );
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'grinder_calibration_notes_len') then
    alter table grinder_calibration add constraint grinder_calibration_notes_len
      check (notes is null or char_length(notes) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'grinder_calibration_samples_size') then
    alter table grinder_calibration add constraint grinder_calibration_samples_size
      check (char_length(samples::text) <= 4096);
  end if;
end $$;

-- ── saved_recipes ─────────────────────────────────────────────────────────────
create table if not exists saved_recipes (
  id           uuid primary key default gen_random_uuid(),
  app_user_id  uuid not null references app_users(id) on delete cascade,
  recipe_code  text not null,
  snapshot     jsonb,
  note         text,
  created_at   timestamptz not null default now(),
  unique (app_user_id, recipe_code)
);
create index if not exists saved_recipes_user_idx on saved_recipes (app_user_id, created_at desc);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'saved_recipes_note_len') then
    alter table saved_recipes add constraint saved_recipes_note_len
      check (note is null or char_length(note) <= 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'saved_recipes_snapshot_size') then
    alter table saved_recipes add constraint saved_recipes_snapshot_size
      check (snapshot is null or char_length(snapshot::text) <= 16384);
  end if;
end $$;

-- ── saved_beans ───────────────────────────────────────────────────────────────
create table if not exists saved_beans (
  id           uuid primary key default gen_random_uuid(),
  app_user_id  uuid not null references app_users(id) on delete cascade,
  bean_id      text not null references beans(id) on delete cascade,
  note         text,
  created_at   timestamptz not null default now(),
  unique (app_user_id, bean_id)
);
create index if not exists saved_beans_user_idx on saved_beans (app_user_id, created_at desc);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'saved_beans_note_len') then
    alter table saved_beans add constraint saved_beans_note_len
      check (note is null or char_length(note) <= 1000);
  end if;
end $$;

-- ── bean_photos (forward-compat) ──────────────────────────────────────────────
create table if not exists bean_photos (
  id          uuid primary key default gen_random_uuid(),
  bean_id     text not null references beans(id) on delete cascade,
  app_user_id uuid references app_users(id) on delete set null,
  url         text not null,
  source      text,
  attribution text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bean_photos_bean_idx on bean_photos (bean_id, sort_order);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bean_photos_url_https') then
    alter table bean_photos add constraint bean_photos_url_https
      check (char_length(url) <= 2048 and url ~ '^https://');
  end if;
end $$;

-- ── bean_purchase_links (forward-compat) ──────────────────────────────────────
create table if not exists bean_purchase_links (
  id            uuid primary key default gen_random_uuid(),
  bean_id       text not null references beans(id) on delete cascade,
  vendor        text not null,
  url           text not null,
  link_category text not null default 'product'
                 check (link_category in ('product','lowest_price','coupon','generic')),
  price_krw     integer,
  is_affiliate  boolean not null default false,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists bean_purchase_links_bean_idx
  on bean_purchase_links (bean_id, sort_order) where active;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bean_purchase_links_url_https') then
    alter table bean_purchase_links add constraint bean_purchase_links_url_https
      check (char_length(url) <= 2048 and url ~ '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bean_purchase_links_vendor_len') then
    alter table bean_purchase_links add constraint bean_purchase_links_vendor_len
      check (char_length(vendor) <= 60);
  end if;
end $$;

-- Down Migration

drop table if exists bean_purchase_links cascade;
drop table if exists bean_photos cascade;
drop table if exists saved_beans cascade;
drop table if exists saved_recipes cascade;
drop table if exists grinder_calibration cascade;
drop table if exists user_gear cascade;
drop table if exists drippers cascade;
drop table if exists grinders cascade;
drop table if exists user_identities cascade;
drop table if exists app_users cascade;
drop table if exists bd_migration_meta cascade;
drop table if exists feedback cascade;
drop table if exists beans cascade;
drop table if exists preferences cascade;
drop table if exists recipes cascade;
drop sequence if exists recipe_code_seq;
drop extension if exists pgcrypto;
