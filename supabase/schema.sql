-- BrewDial — Apps in Toss (Supabase / Postgres) schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).
-- Safe to re-run (idempotent).
--
-- Maps the former CouchDB document model to relational tables:
--   recipe:*    -> recipes
--   feedback:*  -> feedback
--   preference:global -> preferences (single row, id='global')
--   counter:recipe (read-modify-write + 409 retry) -> recipe_code_seq (atomic)

create extension if not exists pgcrypto; -- gen_random_uuid()

-- Sequential recipe codes: COF-0001, COF-0002, ... (atomic, no retry loop)
create sequence if not exists recipe_code_seq start 1;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── recipes ────────────────────────────────────────────────────────────────
create table if not exists recipes (
  id                       uuid primary key default gen_random_uuid(),
  code                     text unique not null
                             default ('COF-' || lpad(nextval('recipe_code_seq')::text, 4, '0')),
  method                   text not null check (method in ('v60','espresso','aeropress','kalita','other')),
  title                    text not null,
  version                  integer not null default 1,
  params                   jsonb not null default '{}'::jsonb,   -- RecipeParams
  steps                    jsonb not null default '[]'::jsonb,   -- RecipeStep[]
  bean_id                  text,
  bean_snapshot            jsonb,                                -- BeanSnapshot
  intent                   text[],
  notes                    text,
  adjustment_from_previous text,
  created_by               text not null default 'manual' check (created_by in ('agent','manual')),
  -- ROB-609: lineage + lifecycle status (re-saves vs intended variants).
  status                   text not null default 'active' check (status in ('active','superseded','archived','test')),
  supersedes               text, -- this recipe replaces <code>
  superseded_by            text, -- this recipe was replaced by <code>
  parent_code              text, -- intended-variant lineage link
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Idempotent ROB-609 upgrade for a table created before status/lineage existed
-- (no-op on the fresh table above). MUST run before the status index.
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
  ratings           jsonb,            -- FeedbackRatings
  actual            jsonb,            -- ActualBrewParams
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

-- ── beans (1급 원두 엔티티; ROB-610: 레시피 기준 → 원두 기준 그룹핑) ─────────────
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
-- 원두 신원 = (이름, 로스터) 정규화 — 같은 원두의 표기 흔들림을 한 행으로 모은다.
create unique index if not exists beans_name_roaster_key
  on beans (lower(name), coalesce(lower(roaster), ''));

-- recipes.bean_id(text, 기존 컬럼; 현재 전부 null)를 beans.id FK로 연결.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_bean_id_fkey') then
    alter table recipes add constraint recipes_bean_id_fkey
      foreign key (bean_id) references beans(id) on delete set null;
  end if;
end $$;

-- bean_snapshot(jsonb)에서 원두를 찾거나 만들어 id 반환. 최신 비어있지-않은 메타 우선.
-- security definer: anon 레시피 생성 경로(트리거)에서도 beans에 쓸 수 있어야 함.
create or replace function find_or_create_bean(snap jsonb)
returns text language plpgsql security definer as $$
declare
  v_name text := nullif(trim(snap->>'name'), '');
  v_roaster text := nullif(trim(snap->>'roaster'), '');
  v_id text;
begin
  if v_name is null then return null; end if;
  insert into beans (name, roaster, origin, process, roast_level, notes)
    values (v_name, v_roaster, snap->>'origin', snap->>'process', snap->>'roastLevel', snap->>'notes')
    on conflict (lower(name), coalesce(lower(roaster), ''))
      do update set
        origin      = coalesce(excluded.origin, beans.origin),
        process     = coalesce(excluded.process, beans.process),
        roast_level = coalesce(excluded.roast_level, beans.roast_level),
        notes       = coalesce(excluded.notes, beans.notes),
        updated_at  = now()
    returning id into v_id;
  return v_id;
end $$;

-- 레시피 insert 시(미니앱 anon / MCP service 모두) bean_id 자동 연결.
create or replace function recipes_link_bean()
returns trigger language plpgsql security definer as $$
begin
  if new.bean_id is null and new.bean_snapshot is not null then
    new.bean_id := find_or_create_bean(new.bean_snapshot);
  end if;
  return new;
end $$;
drop trigger if exists recipes_link_bean_trg on recipes;
create trigger recipes_link_bean_trg before insert on recipes
  for each row execute function recipes_link_bean();

drop trigger if exists recipes_set_updated_at on recipes;
create trigger recipes_set_updated_at before update on recipes
  for each row execute function set_updated_at();
drop trigger if exists feedback_set_updated_at on feedback;
create trigger feedback_set_updated_at before update on feedback
  for each row execute function set_updated_at();
drop trigger if exists preferences_set_updated_at on preferences;
create trigger preferences_set_updated_at before update on preferences
  for each row execute function set_updated_at();
drop trigger if exists beans_set_updated_at on beans;
create trigger beans_set_updated_at before update on beans
  for each row execute function set_updated_at();

-- ── Abuse guardrails (anon writes are public in v1) ─────────────────────────
-- Length + array-size caps so a scripted anon insert can't store huge payloads.
-- (Per-rate throttling relies on Supabase's built-in API rate limiting.)
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

-- ── Row Level Security ───────────────────────────────────────────────────────
-- v1 is anonymous (no Toss Login): public read, anon may create.
-- AI/agent recipes are written by the MCP server using the SERVICE ROLE key,
-- which bypasses RLS — so anon inserts are restricted to created_by='manual'.
alter table recipes     enable row level security;
alter table feedback    enable row level security;
alter table preferences enable row level security;
alter table beans       enable row level security;

drop policy if exists recipes_select on recipes;
create policy recipes_select on recipes
  for select to anon, authenticated using (true);
drop policy if exists recipes_insert on recipes;
create policy recipes_insert on recipes
  for insert to anon, authenticated with check (created_by = 'manual' and status = 'active');

drop policy if exists feedback_select on feedback;
create policy feedback_select on feedback
  for select to anon, authenticated using (true);
drop policy if exists feedback_insert on feedback;
-- anon may only post human-sourced feedback; agent/mcp rows arrive via the
-- SERVICE ROLE (which bypasses RLS), so anon cannot forge AI/agent attribution.
create policy feedback_insert on feedback
  for insert to anon, authenticated with check (source in ('web','coffee_profile'));

drop policy if exists preferences_select on preferences;
create policy preferences_select on preferences
  for select to anon, authenticated using (true);
-- preferences writes intentionally have no anon policy (service role only).

drop policy if exists beans_select on beans;
create policy beans_select on beans
  for select to anon, authenticated using (true);
-- beans writes have no anon policy: the security-definer find_or_create_bean
-- (called by the recipes insert trigger) handles bean creation even for anon.
grant select on beans to anon, authenticated;

insert into preferences (id) values ('global') on conflict (id) do nothing;

-- Migration helper: after importing recipes with explicit COF codes, advance the
-- sequence past the max so newly created recipes don't collide. service_role only.
create or replace function set_recipe_code_seq(n bigint)
returns bigint language sql as $$
  select setval('recipe_code_seq', greatest(n, 1), true);
$$;
revoke all on function set_recipe_code_seq(bigint) from public, anon, authenticated;

-- ── bean_summaries: 원두별 요약(활성 레시피 수/최근/AI 여부) — 미니앱 홈(원두 목록)용 ──
create or replace view bean_summaries
  with (security_invoker = on) as
  select b.id, b.name, b.roaster, b.origin, b.process, b.roast_level, b.notes,
         count(r.code)     filter (where r.status = 'active') as recipe_count,
         max(r.created_at) filter (where r.status = 'active') as latest_recipe_at,
         coalesce(bool_or(r.created_by = 'agent') filter (where r.status = 'active'), false) as has_ai
  from beans b
  left join recipes r on r.bean_id = b.id
  group by b.id;
grant select on bean_summaries to anon, authenticated;

-- ── Backfill: 기존 레시피(bean_id null)를 원두로 묶는다(오래된→최신, 최신 메타 우선). idempotent.
do $$
declare r record;
begin
  for r in
    select code, bean_snapshot from recipes
    where bean_id is null
      and bean_snapshot is not null
      and nullif(trim(bean_snapshot->>'name'), '') is not null
    order by created_at asc
  loop
    update recipes set bean_id = find_or_create_bean(r.bean_snapshot) where code = r.code;
  end loop;
end $$;


-- ============================================================================
-- BrewDial Phase-0 forward-lock migration. LOCKED (adversarial-review v2).
-- APPEND to supabase/schema.sql AFTER the trailing bean-backfill do$$ (line 264).
-- 100% idempotent + strictly ADDITIVE. Re-running the whole schema.sql is safe.
-- Preserves every existing object: recipe_code_seq + COF default, find_or_create_bean,
-- recipes_link_bean trigger, all set_updated_at triggers, bean_summaries (security_invoker),
-- lineage cols, abuse CHECKs, and ALL existing RLS policies (recipes_insert is NOT
-- replaced). Ownership/officialness for anon is attached server-side via SECURITY
-- DEFINER RPCs + a session-flag-gated trigger, never by a client-supplied column.
--
-- RED-TEAM FIXES FOLDED IN (vs prior synthesis):
--   B1  is_official is now a REAL boolean (default false), NOT generated. Only the
--       service role / definer RPCs may set it true. Guarded on INSERT and UPDATE.
--   B2  BEFORE INSERT OR UPDATE trigger hard-forces owner_id:=NULL and
--       is_official:=false for non-service sessions. Owned creation only via
--       rpc_create_owned_recipe (definer path, flagged).
--   B3  Service/definer detection no longer relies on the undocumented
--       request.jwt.role GUC. The guard trusts a txn-local flag bd.owner_write_ok
--       (set ONLY inside our SECURITY DEFINER functions) OR a verified
--       request.jwt.claims->>'role' = 'service_role'. Missing claims => treated as
--       NON-service (anon stays locked). See VERIFY comment at the trigger.
--   M1  resolve_app_user no longer does a racy orphan-delete. It serializes on the
--       identity key via pg_advisory_xact_lock, then re-selects, then inserts.
--   m1  phase0 cutoff persisted in bd_migration_meta (a row), not a per-session GUC.
--   EVO rpc_save_recipe ALWAYS snapshots the recipe server-side (offline-by-construction).
--   EVO rpc_bean_detail(bean_id) returns json (bean + photos + active links) so the
--       future bean-photo/link surfacing is a function-body change, not a view recreate.
-- Section order: meta -> B identity -> A content -> C personalization ->
-- forward-compat -> functions/RPCs -> RLS -> backfill.
-- ════════════════════════════════════════════════════════════════════════════
-- MIGRATION META (m1: persisted one-shot cutoff)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists bd_migration_meta (
  key        text primary key,
  value      text,
  created_at timestamptz not null default now()
);
-- Internal/service-only table. RLS on + NO policy = deny-all to anon/authenticated
-- (the schema-apply role and service_role bypass RLS). This also clears Supabase
-- Studio's "tables without RLS" warning so the safe "Run without RLS" path applies
-- the script verbatim. (DO NOT use Studio's "Run and enable RLS" — its auto-rewrite
-- mis-parses the plpgsql `select ... into v_uid` bodies → 42P01 relation "v_uid".)
alter table bd_migration_meta enable row level security;
-- Captured exactly ONCE (first apply). Re-applying schema.sql never moves it.
insert into bd_migration_meta (key, value)
  values ('phase0_cutoff', now()::text)
  on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- OWNER-WRITE GATE HELPER (B3). Single source of truth for "may this session set
-- owner_id / is_official?". TRUE iff (a) our own SECURITY DEFINER RPC set the
-- txn-local flag bd.owner_write_ok='on', OR (b) the verified PostgREST JWT claims
-- role is service_role. A missing/NULL claim is treated as NON-service so anon is
-- locked by default. This does NOT depend on the undocumented request.jwt.role GUC.
-- VERIFY ON THE LIVE PROJECT before locking: run, under BOTH the anon and the
-- service_role keys:
--   select current_setting('request.jwt.claims', true) as claims,
--          current_setting('request.jwt.claims', true)::jsonb->>'role' as role,
--          current_user, session_user;
-- Confirm service_role returns role='service_role' and anon does not. (If a future
-- PostgREST changes claim shape, only this one function changes.)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function bd_owner_write_allowed()
returns boolean language plpgsql volatile set search_path = public, pg_temp as $$
declare v_flag text; v_claims text;
begin
  -- (a) txn-local flag set by our own definer RPCs (legitimate owned writes).
  v_flag := current_setting('bd.owner_write_ok', true);
  if v_flag = 'on' then return true; end if;
  -- (b) verified service_role via PostgREST JWT claims (robust to missing claims).
  v_claims := current_setting('request.jwt.claims', true);
  if v_claims is not null and v_claims <> '' then
    begin
      if (v_claims::jsonb->>'role') = 'service_role' then return true; end if;
    exception when others then
      return false; -- malformed claims => non-service.
    end;
  end if;
  return false;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- AXIS B — IDENTITY / OWNERSHIP
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  -- v2 join key to Supabase auth (auth.uid()). NULL in v1. Reserved NOW so v2
  -- needs no PK repaint: v2 policies join via this column, not by equating id=uid.
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
drop trigger if exists app_users_set_updated_at on app_users;
create trigger app_users_set_updated_at before update on app_users
  for each row execute function set_updated_at();

create table if not exists user_identities (
  id           uuid primary key default gen_random_uuid(),
  app_user_id  uuid not null references app_users(id) on delete cascade,
  provider     text not null check (provider in ('toss_anon','web_local','toss_login')),
  external_key text not null,
  -- verified=true ONLY for server-verified toss_login (v2 token exchange). v1
  -- spoofable identities are always false (constraint below makes it structural).
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
drop trigger if exists user_identities_set_updated_at on user_identities;
create trigger user_identities_set_updated_at before update on user_identities
  for each row execute function set_updated_at();

-- recipes ownership. owner_id and is_official are INDEPENDENT:
--   owner_id  NULL = anonymous public UGC (NOT a proxy for official).
--   is_official     = operator/agent-curated badge; REAL column, default false.
-- created_by ('agent'|'manual') is UNTOUCHED (HOW, never WHO, never official-ness).
alter table recipes add column if not exists owner_id uuid;
-- B1 FIX: is_official is a REAL boolean (NOT generated), default false. An anon
-- INSERT therefore defaults to is_official=false (UGC), not official.
alter table recipes add column if not exists is_official boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_owner_id_fkey') then
    alter table recipes add constraint recipes_owner_id_fkey
      foreign key (owner_id) references app_users(id) on delete set null;
  end if;
end $$;
-- "official, curated, currently active" feed (badge-driven, NOT owner_id-driven).
create index if not exists recipes_official_active_idx
  on recipes (created_at desc) where is_official and status = 'active';
create index if not exists recipes_owner_idx
  on recipes (owner_id, status, created_at desc) where owner_id is not null;

-- B1+B2+B3 FIX: owner_id / is_official are write-controlled. For any session that
-- is NOT an allowed owner-writer (i.e. anon / authenticated direct table access),
-- hard-FORCE owner_id:=NULL and is_official:=false on BOTH insert and update, and
-- block created_by tampering on update. Allowed owner-writers are (a) our own
-- SECURITY DEFINER RPCs (which set bd.owner_write_ok) and (b) the service role.
-- This closes anon owner-stamping (B2) and anon official-minting (B1) at the table.
--
-- !!! MAINTENANCE WRITES — READ BEFORE TOUCHING owner_id / is_official / created_by:
-- !!! Any raw-SQL maintenance UPDATE/INSERT that needs to set owner_id, is_official,
-- !!! or created_by MUST first run, in the SAME txn/block:
-- !!!     perform set_config('bd.owner_write_ok','on', true);   -- (or: select set_config(...))
-- !!! ...then perform the write, then reset it to 'off'. Otherwise THIS guard will
-- !!! SILENTLY revert those columns (INSERT) or RAISE (UPDATE). The flag is the only
-- !!! legitimate non-service path to write these columns; forgetting it means your
-- !!! maintenance change is quietly neutralized. Always wrap on->work->off so a
-- !!! raised error can never leave the flag stuck 'on' for the rest of the txn.
create or replace function bd_guard_recipe_owner_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not public.bd_owner_write_allowed() then
    if tg_op = 'INSERT' then
      -- anon/public path: can never stamp an owner or mint official content.
      new.owner_id    := null;
      new.is_official := false;
      -- created_by integrity (belt-and-suspenders to the recipes_insert RLS policy):
      -- non-owner-writer INSERTs are always 'manual'; never let the client mint
      -- 'agent' rows directly at the table.
      new.created_by  := 'manual';
    elsif tg_op = 'UPDATE' then
      if new.owner_id    is distinct from old.owner_id then
        raise exception 'owner_id is immutable for non-owner-writer sessions';
      end if;
      if new.is_official is distinct from old.is_official then
        raise exception 'is_official is immutable for non-owner-writer sessions';
      end if;
      if new.created_by  is distinct from old.created_by then
        raise exception 'created_by is immutable for non-owner-writer sessions';
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists recipes_guard_owner_immutable on recipes;
create trigger recipes_guard_owner_immutable
  before insert or update on recipes
  for each row execute function bd_guard_recipe_owner_immutable();

-- feedback ownership (reserved NOW so "my brews / my feedback" never needs an
-- ALTER on a populated table). NULL = legacy/anonymous, exactly like recipes.
alter table feedback add column if not exists owner_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_owner_id_fkey') then
    alter table feedback add constraint feedback_owner_id_fkey
      foreign key (owner_id) references app_users(id) on delete set null;
  end if;
end $$;
create index if not exists feedback_owner_idx on feedback (owner_id) where owner_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- AXIS A — RECIPE CONTENT (611 grind + 612 dripper portability)
-- grind stays INSIDE params (string|GrindSpec); dripper_portability is its OWN
-- top-level jsonb column. SHARED registries are normalized TABLES.
-- ════════════════════════════════════════════════════════════════════════════
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

-- SHARED grinder registry (611). Bean-agnostic, user-agnostic, curated.
create table if not exists grinders (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  um_per_click_est    numeric,            -- ADVISORY ONLY (absolute microns unreliable)
  um_per_click_source text check (um_per_click_source in ('measured','estimated','unknown')),
  zero_ref            text,
  stepless            boolean not null default false,      -- 무단 grinder
  brew_method_ranges  jsonb not null default '{}'::jsonb,  -- {v60:{from,to,unit}}
  anchor_point        jsonb,              -- {method, position, targetDrawdownSec}
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
drop trigger if exists grinders_set_updated_at on grinders;
create trigger grinders_set_updated_at before update on grinders
  for each row execute function set_updated_at();

-- SHARED dripper registry (612). Class-based continuum; no scalar invariant.
create table if not exists drippers (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  class                  text not null check (class in ('bed_restricted','dripper_restricted','hybrid','immersion')),
  geometry               text check (geometry in ('cone','flat','wedge','basket')),
  continuum_position     numeric check (continuum_position is null or (continuum_position between 0 and 1)),
  hole_spec              jsonb not null default '{}'::jsonb,
  filter_type            text,
  recommended_dose_range jsonb not null default '{}'::jsonb,  -- {minG,maxG}
  size_models            jsonb not null default '[]'::jsonb,  -- [{model,maxDoseG,bedDepthFactor}]
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
drop trigger if exists drippers_set_updated_at on drippers;
create trigger drippers_set_updated_at before update on drippers
  for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- AXIS C — PERSONALIZATION / GEAR (per-user; LOCK RULE: never on the recipe row)
-- ════════════════════════════════════════════════════════════════════════════
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
drop trigger if exists user_gear_set_updated_at on user_gear;
create trigger user_gear_set_updated_at before update on user_gear
  for each row execute function set_updated_at();

-- 611 per-user calibration. ANCHOR-AWARE + range-aware sampled pairs.
create table if not exists grinder_calibration (
  id               uuid primary key default gen_random_uuid(),
  app_user_id      uuid not null references app_users(id) on delete cascade,
  from_grinder_id  uuid references grinders(id) on delete set null,
  to_grinder_id    uuid references grinders(id) on delete set null,
  from_label       text not null,
  to_label         text not null,
  anchor_method    text,
  samples          jsonb not null default '[]'::jsonb, -- [{fromClicks,toClicks,targetDrawdownSec,brewPosition}]
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
drop trigger if exists grinder_calibration_set_updated_at on grinder_calibration;
create trigger grinder_calibration_set_updated_at before update on grinder_calibration
  for each row execute function set_updated_at();

create table if not exists saved_recipes (
  id           uuid primary key default gen_random_uuid(),
  app_user_id  uuid not null references app_users(id) on delete cascade,
  recipe_code  text not null,            -- COF-NNNN (no FK; survives hard-delete)
  snapshot     jsonb,                    -- ALWAYS populated server-side (EVO fix)
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

-- ════════════════════════════════════════════════════════════════════════════
-- FORWARD-COMPAT RESERVE (design now, DO NOT wire UI). Child tables off beans.id;
-- never touch beans_name_roaster_key. Curated by service role.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists bean_photos (
  id          uuid primary key default gen_random_uuid(),
  bean_id     text not null references beans(id) on delete cascade,
  app_user_id uuid references app_users(id) on delete set null,  -- null = operator/curated
  url         text not null,
  source      text,                 -- 'roaster'|'user'|'vendor'|'operator'
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
drop trigger if exists bean_photos_set_updated_at on bean_photos;
create trigger bean_photos_set_updated_at before update on bean_photos
  for each row execute function set_updated_at();

-- Purchase links. link_category records WHICH Toss-allowed exemption applies so
-- the Toss-surface renderer can self-document. Toss restricts external-link nav in
-- general but explicitly ALLOWS: product intro -> lowest-price/purchase platform,
-- and move-to-coupon-platform. Data is always carried; the Toss renderer MUST gate
-- display on getEnv()==='toss' + link_category in the allowed set. Web is free.
create table if not exists bean_purchase_links (
  id            uuid primary key default gen_random_uuid(),
  bean_id       text not null references beans(id) on delete cascade,
  vendor        text not null,        -- 'coupang'|'naver_store'|...
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
drop trigger if exists bean_purchase_links_set_updated_at on bean_purchase_links;
create trigger bean_purchase_links_set_updated_at before update on bean_purchase_links
  for each row execute function set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- IDENTITY RESOLVER + WRITE RPCs (SECURITY DEFINER). THE KEYSTONE: anon never
-- passes app_user_id/owner_id into a table policy. Each RPC takes only
-- (provider, external_key) + payload, resolves the app_user server-side, and
-- writes rows scoped to THAT app_user. Spoof blast radius == localStorage status quo.
-- ════════════════════════════════════════════════════════════════════════════

-- M1 FIX: resolve-or-create with NO orphan window and NO racy cleanup DELETE.
-- Serialize on the identity key with a txn advisory lock, re-select, then insert.
create or replace function resolve_app_user(p_provider text, p_external_key text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid;
begin
  if p_provider not in ('toss_anon','web_local') then
    raise exception 'resolve_app_user: v1 RPC accepts only toss_anon|web_local';
  end if;
  if nullif(trim(p_external_key),'') is null or char_length(p_external_key) < 16 then
    raise exception 'resolve_app_user: external_key too short';
  end if;

  -- Serialize concurrent first-touches of the SAME (provider, key). Released at
  -- txn end. Eliminates the create-then-cleanup race entirely (no orphan window).
  perform pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_external_key, 0));

  select app_user_id into v_uid from user_identities
    where provider = p_provider and external_key = p_external_key;
  if v_uid is not null then return v_uid; end if;

  insert into app_users default values returning id into v_uid;
  insert into user_identities (app_user_id, provider, external_key, verified)
    values (v_uid, p_provider, p_external_key, false);
  return v_uid;
end $$;
revoke all on function resolve_app_user(text, text) from public;
grant execute on function resolve_app_user(text, text) to anon, authenticated, service_role;

-- Owned UGC recipe creation for anon ("save as mine"). Resolves identity, then
-- sets the txn-local owner-write flag so the recipes guard PERMITS owner_id +
-- is_official=false to be written (B2/B3: definer path is the only non-service way
-- to legitimately stamp owner_id). Forces created_by='manual'/status='active' and
-- NEVER is_official=true. Anon cannot mint official/agent rows. Returns the code.
create or replace function rpc_create_owned_recipe(
  p_provider text, p_external_key text, p_recipe jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid; v_code text;
begin
  v_uid := resolve_app_user(p_provider, p_external_key);
  -- on->work->off, wrapped so a raised CHECK/FK error can never leave the flag 'on'
  -- for the rest of the txn (flag leak guard).
  begin
    perform set_config('bd.owner_write_ok', 'on', true);  -- txn-local; trigger honors it
    insert into recipes (method, title, params, steps, bean_snapshot, intent, notes,
                         adjustment_from_previous, dripper_portability, owner_id,
                         is_official, created_by, status)
    values (
      p_recipe->>'method',
      p_recipe->>'title',
      coalesce(p_recipe->'params','{}'::jsonb),
      coalesce(p_recipe->'steps','[]'::jsonb),
      p_recipe->'beanSnapshot',
      case when p_recipe ? 'intent'
           then array(select jsonb_array_elements_text(p_recipe->'intent')) end,
      p_recipe->>'notes',
      p_recipe->>'adjustmentFromPrevious',
      p_recipe->'dripperPortability',
      v_uid, false, 'manual', 'active')
    returning code into v_code;
    perform set_config('bd.owner_write_ok', 'off', true);  -- close the window
  exception when others then
    perform set_config('bd.owner_write_ok', 'off', true);  -- never leak the flag
    raise;
  end;
  return v_code;
end $$;
revoke all on function rpc_create_owned_recipe(text, text, jsonb) from public;
grant execute on function rpc_create_owned_recipe(text, text, jsonb) to anon, authenticated, service_role;

-- Personalization upserts. All resolve identity and scope writes to it.
create or replace function rpc_upsert_gear(
  p_provider text, p_external_key text, p_gear jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := resolve_app_user(p_provider, p_external_key);
  -- One default per (app_user, kind): clear the prior default before inserting a new
  -- default, else user_gear_one_default_uidx raises on the 2nd default of a kind.
  if coalesce((p_gear->>'isDefault')::boolean, false) then
    update user_gear set is_default = false
      where app_user_id = v_uid and kind = p_gear->>'kind' and is_default;
  end if;
  insert into user_gear (app_user_id, kind, grinder_id, dripper_id, label, details, is_default)
  values (v_uid, p_gear->>'kind',
          nullif(p_gear->>'grinderId','')::uuid, nullif(p_gear->>'dripperId','')::uuid,
          p_gear->>'label', coalesce(p_gear->'details','{}'::jsonb),
          coalesce((p_gear->>'isDefault')::boolean,false))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function rpc_upsert_gear(text, text, jsonb) from public;
grant execute on function rpc_upsert_gear(text, text, jsonb) to anon, authenticated, service_role;

-- ROB-611 (D): per-user grinder-pair calibration upsert. Resolves identity and
-- scopes the row to it. Conflict target matches grinder_calibration_pair_uidx
-- (coalesce-stable pair key). from_label/to_label are required.
create or replace function rpc_upsert_calibration(
  p_provider text, p_external_key text, p_cal jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid; v_id uuid;
begin
  v_uid := resolve_app_user(p_provider, p_external_key);
  insert into grinder_calibration (app_user_id, from_grinder_id, to_grinder_id,
                                   from_label, to_label, anchor_method, samples, source, notes)
  values (
    v_uid,
    nullif(p_cal->>'fromGrinderId','')::uuid,
    nullif(p_cal->>'toGrinderId','')::uuid,
    p_cal->>'fromLabel',
    p_cal->>'toLabel',
    nullif(p_cal->>'anchorMethod',''),
    coalesce(p_cal->'samples','[]'::jsonb),
    coalesce(nullif(p_cal->>'source',''), 'measured'),
    p_cal->>'notes')
  on conflict (app_user_id,
               coalesce(from_grinder_id::text, lower(from_label)),
               coalesce(to_grinder_id::text,   lower(to_label)),
               coalesce(anchor_method, ''))
  do update set samples = excluded.samples,
                source  = excluded.source,
                notes   = excluded.notes
  returning id into v_id;
  return v_id;
end $$;
revoke all on function rpc_upsert_calibration(text, text, jsonb) from public;
grant execute on function rpc_upsert_calibration(text, text, jsonb) to anon, authenticated, service_role;

-- EVO FIX: rpc_save_recipe ALWAYS populates snapshot server-side by looking up the
-- recipe row by code inside the definer fn. "Saved recipes render offline" is now
-- true by construction — no future backfill. p_note is the only client free-text.
-- (A non-existent/test code yields a NULL snapshot but still records the save.)
-- Snapshot is the COMPLETE recipe row (to_jsonb(r.*)) so future/lineage columns
-- (created_by, supersedes, superseded_by, parent_code, owner_id, ...) are captured
-- without a hardcoded column list to maintain. status='test' rows are still excluded.
create or replace function rpc_save_recipe(
  p_provider text, p_external_key text, p_code text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid; v_snapshot jsonb;
begin
  v_uid := resolve_app_user(p_provider, p_external_key);
  select to_jsonb(r.*) into v_snapshot
    from recipes r where r.code = p_code and r.status <> 'test';
  insert into saved_recipes (app_user_id, recipe_code, snapshot, note)
  values (v_uid, p_code, v_snapshot, p_note)
  on conflict (app_user_id, recipe_code)
    do update set snapshot = coalesce(excluded.snapshot, saved_recipes.snapshot),
                  note     = coalesce(excluded.note, saved_recipes.note);
end $$;
revoke all on function rpc_save_recipe(text, text, text, text) from public;
grant execute on function rpc_save_recipe(text, text, text, text) to anon, authenticated, service_role;

create or replace function rpc_save_bean(
  p_provider text, p_external_key text, p_bean_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid;
begin
  v_uid := resolve_app_user(p_provider, p_external_key);
  insert into saved_beans (app_user_id, bean_id) values (v_uid, p_bean_id)
  on conflict (app_user_id, bean_id) do nothing;
end $$;
revoke all on function rpc_save_bean(text, text, text) from public;
grant execute on function rpc_save_bean(text, text, text) to anon, authenticated, service_role;

-- "My stuff" reads also go through a definer RPC (no blanket anon SELECT on
-- per-user tables → no enumeration by spoofing keys one at a time at the table).
create or replace function rpc_my_collections(p_provider text, p_external_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid;
begin
  v_uid := resolve_app_user(p_provider, p_external_key);
  return jsonb_build_object(
    'savedRecipes', (select coalesce(jsonb_agg(s order by s.created_at desc),'[]'::jsonb)
                       from saved_recipes s where s.app_user_id = v_uid),
    'savedBeans',   (select coalesce(jsonb_agg(s order by s.created_at desc),'[]'::jsonb)
                       from saved_beans s where s.app_user_id = v_uid),
    'gear',         (select coalesce(jsonb_agg(g),'[]'::jsonb)
                       from user_gear g where g.app_user_id = v_uid),
    'calibration',  (select coalesce(jsonb_agg(c),'[]'::jsonb)
                       from grinder_calibration c where c.app_user_id = v_uid),
    'myRecipes',    (select coalesce(jsonb_agg(r.code),'[]'::jsonb)
                       from recipes r where r.owner_id = v_uid));
end $$;
revoke all on function rpc_my_collections(text, text) from public;
grant execute on function rpc_my_collections(text, text) to anon, authenticated, service_role;

-- EVO FIX: rpc_bean_detail(bean_id) -> json (bean + photos + active purchase links).
-- Surfacing photos/links LATER is now a function-body change here, NOT a
-- bean_summaries view recreate + BEAN_COLUMNS edits in two readers. Public read.
create or replace function rpc_bean_detail(p_bean_id text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when b.id is null then null else jsonb_build_object(
    'bean', to_jsonb(b),
    'photos', (select coalesce(jsonb_agg(p order by p.sort_order, p.created_at),'[]'::jsonb)
                 from bean_photos p where p.bean_id = b.id),
    'purchaseLinks', (select coalesce(jsonb_agg(l order by l.sort_order, l.created_at),'[]'::jsonb)
                 from bean_purchase_links l where l.bean_id = b.id and l.active)
  ) end
  from (select * from beans where id = p_bean_id) b;
$$;
revoke all on function rpc_bean_detail(text) from public;
grant execute on function rpc_bean_detail(text) to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- v2 IDENTITY MERGE — pure DATA op (service role / Edge Function only).
-- ABSORB-AUTHORIZED: the Edge Function must have proven, in the same verified
-- session, that the caller controls each source identity before passing it.
-- B3 NOTE: this runs under the service role AND is SECURITY DEFINER; its
-- `update recipes set owner_id = p_keep` is permitted because (a) service_role
-- satisfies bd_owner_write_allowed via JWT claims, and (b) belt-and-suspenders,
-- it also sets the txn-local owner-write flag so the recipes guard never blocks it.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function merge_app_users(p_keep uuid, p_absorb uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_keep is null or p_absorb is null or p_keep = p_absorb then return; end if;
  -- on->work->off, wrapped so a raised error can never leave the flag stuck 'on'
  -- for the rest of the txn (flag leak guard).
  begin
    perform set_config('bd.owner_write_ok', 'on', true);  -- allow owner re-point

    -- saved_recipes: drop colliding source rows, then re-point.
    delete from saved_recipes s using saved_recipes t
      where s.app_user_id = p_absorb and t.app_user_id = p_keep and s.recipe_code = t.recipe_code;
    update saved_recipes set app_user_id = p_keep where app_user_id = p_absorb;

    -- saved_beans: same pattern.
    delete from saved_beans s using saved_beans t
      where s.app_user_id = p_absorb and t.app_user_id = p_keep and s.bean_id = t.bean_id;
    update saved_beans set app_user_id = p_keep where app_user_id = p_absorb;

    -- grinder_calibration: drop colliding source pairs (coalesce-stable key), re-point.
    delete from grinder_calibration s using grinder_calibration t
      where s.app_user_id = p_absorb and t.app_user_id = p_keep
        and coalesce(s.from_grinder_id::text, lower(s.from_label))
          = coalesce(t.from_grinder_id::text, lower(t.from_label))
        and coalesce(s.to_grinder_id::text, lower(s.to_label))
          = coalesce(t.to_grinder_id::text, lower(t.to_label))
        and coalesce(s.anchor_method,'') = coalesce(t.anchor_method,'');
    update grinder_calibration set app_user_id = p_keep where app_user_id = p_absorb;

    -- user_gear: clear source defaults that would collide with a kept default, re-point.
    update user_gear g set is_default = false
      where g.app_user_id = p_absorb and g.is_default
        and exists (select 1 from user_gear k
                    where k.app_user_id = p_keep and k.kind = g.kind and k.is_default);
    update user_gear set app_user_id = p_keep where app_user_id = p_absorb;

    -- bean_photos UGC re-point (reserved-now app_user_id); collisions are not unique-keyed.
    update bean_photos set app_user_id = p_keep where app_user_id = p_absorb;

    -- ownership + remaining identities, then drop the empty source.
    update recipes  set owner_id = p_keep where owner_id = p_absorb;
    update feedback set owner_id = p_keep where owner_id = p_absorb;
    update user_identities set app_user_id = p_keep where app_user_id = p_absorb;
    delete from app_users where id = p_absorb
      and not exists (select 1 from user_identities where app_user_id = p_absorb);

    perform set_config('bd.owner_write_ok', 'off', true);
  exception when others then
    perform set_config('bd.owner_write_ok', 'off', true);  -- never leak the flag
    raise;
  end;
end $$;
revoke all on function merge_app_users(uuid, uuid) from public, anon, authenticated;
grant execute on function merge_app_users(uuid, uuid) to service_role;

-- Service-role officialization helper (curated agent/operator promotes a recipe).
-- Lives as a definer fn so the operator never needs to touch is_official directly;
-- the guard permits it because service_role satisfies bd_owner_write_allowed.
create or replace function rpc_set_recipe_official(p_code text, p_official boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- on->work->off, wrapped so a raised error can never leave the flag stuck 'on'
  -- for the rest of the txn (flag leak guard).
  begin
    perform set_config('bd.owner_write_ok', 'on', true);
    update recipes set is_official = p_official where code = p_code;
    perform set_config('bd.owner_write_ok', 'off', true);
  exception when others then
    perform set_config('bd.owner_write_ok', 'off', true);  -- never leak the flag
    raise;
  end;
end $$;
revoke all on function rpc_set_recipe_official(text, boolean) from public, anon, authenticated;
grant execute on function rpc_set_recipe_official(text, boolean) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS. PRESERVE all existing policies. recipes_insert is NOT replaced — anon
-- direct insert stays exactly as today; the BEFORE INSERT guard now NULLs
-- owner_id and forces is_official=false for that path. New tables get policies;
-- identity/personalization tables are DENY-to-anon (RPC-mediated only).
-- ════════════════════════════════════════════════════════════════════════════
alter table app_users           enable row level security;
alter table user_identities     enable row level security;
alter table grinders            enable row level security;
alter table drippers            enable row level security;
alter table user_gear           enable row level security;
alter table grinder_calibration enable row level security;
alter table saved_recipes       enable row level security;
alter table saved_beans         enable row level security;
alter table bean_photos         enable row level security;
alter table bean_purchase_links enable row level security;

-- Registries + forward-compat curated data: public READ, NO anon write (service role).
drop policy if exists grinders_select on grinders;
create policy grinders_select on grinders for select to anon, authenticated using (true);
drop policy if exists drippers_select on drippers;
create policy drippers_select on drippers for select to anon, authenticated using (true);
drop policy if exists bean_photos_select on bean_photos;
create policy bean_photos_select on bean_photos for select to anon, authenticated using (true);
drop policy if exists bean_purchase_links_select on bean_purchase_links;
create policy bean_purchase_links_select on bean_purchase_links
  for select to anon, authenticated using (active = true);
grant select on grinders, drippers, bean_photos, bean_purchase_links to anon, authenticated;

-- Identity + personalization tables: RLS enabled, ZERO anon policy = deny-all to
-- anon. Reached ONLY via the SECURITY DEFINER RPCs above. Service role bypasses.
-- (No grant of insert/update/delete/select to anon on these tables — deliberate.)
-- v2 templates (SHIPPED LATER, add-only, no schema/policy churn):
--   create policy user_gear_rw_v2 on user_gear for all to authenticated
--     using (app_user_id in (select id from app_users where auth_user_id = auth.uid()))
--     with check (app_user_id in (select id from app_users where auth_user_id = auth.uid()));
--   (same shape for saved_recipes/saved_beans/grinder_calibration; recipes update
--    owner via owner_id in (...auth_user_id = auth.uid()) and is_official=false.)

-- ════════════════════════════════════════════════════════════════════════════
-- BACKFILL (idempotent; the only semantic backfill is bounded by the persisted
-- one-shot cutoff in bd_migration_meta so re-runs never touch post-launch UGC).
-- ════════════════════════════════════════════════════════════════════════════
-- 1) owner_id: existing rows stay NULL (= anonymous; they predate identity). Correct.
--    feedback.owner_id likewise stays NULL. No write needed.

-- 2) is_official BACKFILL — VERIFY-FIRST, ONE-SHOT, BOUNDED.
--    is_official defaulted FALSE for all existing rows (B1). In THIS workspace the
--    pre-Phase-0 corpus is the operator's own curation (UGC is only now introduced),
--    so pre-cutoff rows should be marked official. We mark ONLY rows created BEFORE
--    the persisted cutoff. We NEVER blanket-true post-cutoff rows.
--
--    >>> OPERATOR: BEFORE the first apply, RUN AND CONFIRM the distribution. <<<
--        select created_by, owner_id is null as anon_owner, count(*)
--          from recipes
--         where created_at < (select value from bd_migration_meta where key='phase0_cutoff')::timestamptz
--         group by 1, 2 order by 1, 2;
--    If EVERY pre-cutoff row is genuinely operator-curated (no pre-existing anon
--    UGC that would be wrongly officialized), keep the UPDATE below as-is. If anon
--    UGC already exists pre-cutoff, NARROW the predicate (e.g. add
--    `and created_by = 'agent'`, the MCP service-role corpus) before applying.
--    Re-runs are safe: the IS DISTINCT FROM guard makes the UPDATE a no-op once set,
--    and the cutoff is frozen in bd_migration_meta.
--
--    NOTE: this direct UPDATE writes is_official, which bd_guard_recipe_owner_immutable
--    governs. The block MUST set bd.owner_write_ok='on' first, else the guard RAISES
--    (is_official immutable for non-owner-writer sessions) under anon, or — if this
--    block ran in a non-service session — silently neutralizes the backfill. We set
--    the flag on, run the UPDATE, set it off, and reset it on error so it never leaks.
do $$
declare v_cutoff timestamptz;
begin
  select value::timestamptz into v_cutoff from bd_migration_meta where key = 'phase0_cutoff';
  begin
    perform set_config('bd.owner_write_ok', 'on', true);  -- let the guard allow is_official write
    update recipes
       set is_official = true
     where created_at < v_cutoff
       and is_official is distinct from true;
     -- ^ To restrict to agent-authored only, append: and created_by = 'agent'
    perform set_config('bd.owner_write_ok', 'off', true);
  exception when others then
    perform set_config('bd.owner_write_ok', 'off', true);  -- never leak the flag
    raise;
  end;
end $$;

-- 3) legacy params.grind string: NOT rewritten in SQL (verbatim-stable; validator
--    coerces string -> {legacyText} at read time). No-op by design.

-- 4) dripper_portability stays NULL for legacy rows (reader infers origin from
--    method + params.doseG). No row write. (Optional later enrichment is gated and
--    bounded by created_at < the bd_migration_meta cutoff; see backfill_plan.)

-- 5) Seed grinder registry from GRINDER_PRESETS.
insert into grinders (name) values
  ('KINGrinder K6'),('Comandante C40'),('1Zpresso J-Max'),('1Zpresso JX-Pro'),
  ('Timemore C3'),('Baratza Encore'),('Fellow Ode Gen2'),('Wilfa Uniform')
on conflict (lower(name)) do nothing;

-- 5b) ROB-611: enrich the registry with metadata for the conversion helper.
--     um_per_click_est is ADVISORY (absolute microns unreliable). The robust
--     cross-grinder anchor is brew_method_ranges (each grinder's V60 click band).
--     Adds 'Comandante C40 Red Clix' (finer stepped axle). Idempotent upsert.
insert into grinders (name, um_per_click_est, um_per_click_source, brew_method_ranges, anchor_point, notes) values
  ('KINGrinder K6', 7.5, 'estimated',
   '{"v60":{"from":90,"to":108}}'::jsonb,
   '{"method":"v60","clicks":102,"targetDrawdownSec":265,"note":"40g/620g 4:25-4:45 = medium"}'::jsonb,
   'Dial label 16µm/click is the dial scale, not real particle output (~7.5µm/click effective).'),
  ('Comandante C40', 30, 'estimated',
   '{"v60":{"from":22,"to":30}}'::jsonb,
   '{"method":"v60","clicks":26}'::jsonb,
   'Standard axle; community estimates ~25-30µm/click.'),
  ('Comandante C40 Red Clix', 15, 'estimated',
   '{"v60":{"from":44,"to":60}}'::jsonb,
   '{"method":"v60","clicks":52}'::jsonb,
   'Red Clix finer-stepped axle (~15µm/click); roughly 2x the click count of the standard axle.'),
  ('1Zpresso J-Max', 8.8, 'estimated',
   '{"v60":{"from":50,"to":68}}'::jsonb,
   null,
   '8.8µm/click external-adjust hand grinder.')
on conflict (lower(name)) do update set
  um_per_click_est    = excluded.um_per_click_est,
  um_per_click_source = excluded.um_per_click_source,
  brew_method_ranges  = excluded.brew_method_ranges,
  anchor_point        = excluded.anchor_point,
  notes               = excluded.notes;

-- 6) Seed dripper registry with corrected coffee-domain classification.
insert into drippers (name, class, geometry, continuum_position, filter_type, recommended_dose_range) values
  ('Hario V60',      'bed_restricted',     'cone',  0.05, 'paper_cone',  '{"minG":12,"maxG":30}'::jsonb),
  ('Origami',        'hybrid',             'cone',  0.40, 'paper_cone',  '{"minG":12,"maxG":30}'::jsonb),
  ('Kalita Wave 185','dripper_restricted', 'flat',  0.85, 'paper_flat',  '{"minG":15,"maxG":28}'::jsonb),
  ('Melitta',        'dripper_restricted', 'wedge', 0.80, 'paper_wedge', '{"minG":12,"maxG":30}'::jsonb),
  ('Chemex',         'bed_restricted',     'cone',  0.15, 'paper_thick', '{"minG":30,"maxG":60}'::jsonb)
on conflict (lower(name)) do nothing;

-- 6b) ROB-612 Slice B: correct continuum_position to FLOW RESTRICTION (0 = fast /
--     bed-controlled like V60·Origami cone .. 1 = slow / dripper-controlled like
--     Kalita·Melitta; Chemex is bed-shaped but its thick bonded paper slows a lot).
--     Add size_models (maxDoseG) for the 40g bed-overflow check. Idempotent upsert.
insert into drippers (name, class, continuum_position, recommended_dose_range, size_models) values
  ('Hario V60',       'bed_restricted',     0.10, '{"minG":12,"maxG":30}'::jsonb,
   '[{"model":"01","maxDoseG":18},{"model":"02","maxDoseG":30},{"model":"03","maxDoseG":45}]'::jsonb),
  ('Origami',         'hybrid',             0.05, '{"minG":12,"maxG":30}'::jsonb,
   '[{"model":"S","maxDoseG":20},{"model":"M","maxDoseG":36}]'::jsonb),
  ('Chemex',          'bed_restricted',     0.50, '{"minG":30,"maxG":70}'::jsonb,
   '[{"model":"3cup","maxDoseG":30},{"model":"6cup","maxDoseG":55},{"model":"8cup","maxDoseG":70}]'::jsonb),
  ('Kalita Wave 185', 'dripper_restricted', 0.85, '{"minG":15,"maxG":35}'::jsonb,
   '[{"model":"155","maxDoseG":20},{"model":"185","maxDoseG":35}]'::jsonb),
  ('Melitta',         'dripper_restricted', 0.80, '{"minG":12,"maxG":30}'::jsonb,
   '[{"model":"1x2","maxDoseG":24},{"model":"1x4","maxDoseG":40}]'::jsonb)
on conflict (lower(name)) do update set
  continuum_position     = excluded.continuum_position,
  recommended_dose_range = excluded.recommended_dose_range,
  size_models            = excluded.size_models;