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
