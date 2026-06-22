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

drop trigger if exists recipes_set_updated_at on recipes;
create trigger recipes_set_updated_at before update on recipes
  for each row execute function set_updated_at();
drop trigger if exists feedback_set_updated_at on feedback;
create trigger feedback_set_updated_at before update on feedback
  for each row execute function set_updated_at();
drop trigger if exists preferences_set_updated_at on preferences;
create trigger preferences_set_updated_at before update on preferences
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

insert into preferences (id) values ('global') on conflict (id) do nothing;

-- Migration helper: after importing recipes with explicit COF codes, advance the
-- sequence past the max so newly created recipes don't collide. service_role only.
create or replace function set_recipe_code_seq(n bigint)
returns bigint language sql as $$
  select setval('recipe_code_seq', greatest(n, 1), true);
$$;
revoke all on function set_recipe_code_seq(bigint) from public, anon, authenticated;
