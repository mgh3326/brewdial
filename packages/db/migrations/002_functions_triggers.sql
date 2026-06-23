-- Up Migration

-- ── set_updated_at trigger function ─────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── set_updated_at triggers on all tables ────────────────────────────────────
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
drop trigger if exists app_users_set_updated_at on app_users;
create trigger app_users_set_updated_at before update on app_users
  for each row execute function set_updated_at();
drop trigger if exists user_identities_set_updated_at on user_identities;
create trigger user_identities_set_updated_at before update on user_identities
  for each row execute function set_updated_at();
drop trigger if exists grinders_set_updated_at on grinders;
create trigger grinders_set_updated_at before update on grinders
  for each row execute function set_updated_at();
drop trigger if exists drippers_set_updated_at on drippers;
create trigger drippers_set_updated_at before update on drippers
  for each row execute function set_updated_at();
drop trigger if exists user_gear_set_updated_at on user_gear;
create trigger user_gear_set_updated_at before update on user_gear
  for each row execute function set_updated_at();
drop trigger if exists grinder_calibration_set_updated_at on grinder_calibration;
create trigger grinder_calibration_set_updated_at before update on grinder_calibration
  for each row execute function set_updated_at();
drop trigger if exists bean_photos_set_updated_at on bean_photos;
create trigger bean_photos_set_updated_at before update on bean_photos
  for each row execute function set_updated_at();
drop trigger if exists bean_purchase_links_set_updated_at on bean_purchase_links;
create trigger bean_purchase_links_set_updated_at before update on bean_purchase_links
  for each row execute function set_updated_at();

-- ── find_or_create_bean ───────────────────────────────────────────────────────
-- security definer: anon recipe creation path (trigger) needs to write to beans.
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

-- ── recipes_link_bean ─────────────────────────────────────────────────────────
-- auto-links bean_id on recipe insert when bean_snapshot is present and bean_id is null.
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

-- ── bd_owner_write_allowed (reworked: no PostgREST GUC) ──────────────────────
-- Reworked for plain Postgres + trusted backend: owner/official writes are allowed
-- ONLY inside a transaction that set the txn-local flag bd.owner_write_ok='on'
-- (our own write services/functions do this). No PostgREST JWT branch exists here.
-- coalesce ensures missing setting returns '' not NULL so the = 'on' comparison
-- yields false (not NULL) for the trigger's IF NOT ... guard.
create or replace function bd_owner_write_allowed()
returns boolean language plpgsql volatile set search_path = public, pg_temp as $$
begin
  return coalesce(current_setting('bd.owner_write_ok', true), '') = 'on';
end $$;

-- ── bd_guard_recipe_owner_immutable ──────────────────────────────────────────
-- B1+B2+B3 FIX: owner_id / is_official / created_by are write-controlled.
-- For any session that is NOT an allowed owner-writer, hard-FORCE owner_id:=NULL
-- and is_official:=false on INSERT, and RAISE on UPDATE for those columns.
create or replace function bd_guard_recipe_owner_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not public.bd_owner_write_allowed() then
    if tg_op = 'INSERT' then
      -- anon/public path: can never stamp an owner or mint official content.
      new.owner_id    := null;
      new.is_official := false;
      -- created_by integrity: non-owner-writer INSERTs are always 'manual'.
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

-- ── set_recipe_code_seq ───────────────────────────────────────────────────────
-- Migration helper: advance the sequence past the max to avoid code collisions.
create or replace function set_recipe_code_seq(n bigint)
returns bigint language sql as $$
  select setval('recipe_code_seq', greatest(n, 1), true);
$$;

-- ── bean_summaries view ───────────────────────────────────────────────────────
create or replace view bean_summaries
  with (security_invoker = on) as
  select b.id, b.name, b.roaster, b.origin, b.process, b.roast_level, b.notes,
         count(r.code)     filter (where r.status = 'active') as recipe_count,
         max(r.created_at) filter (where r.status = 'active') as latest_recipe_at,
         coalesce(bool_or(r.created_by = 'agent') filter (where r.status = 'active'), false) as has_ai
  from beans b
  left join recipes r on r.bean_id = b.id
  group by b.id;

-- Down Migration

drop view if exists bean_summaries;
drop trigger if exists recipes_guard_owner_immutable on recipes;
drop function if exists bd_guard_recipe_owner_immutable();
drop function if exists bd_owner_write_allowed();
drop trigger if exists recipes_link_bean_trg on recipes;
drop function if exists recipes_link_bean();
drop function if exists find_or_create_bean(jsonb);
drop function if exists set_recipe_code_seq(bigint);
drop trigger if exists bean_purchase_links_set_updated_at on bean_purchase_links;
drop trigger if exists bean_photos_set_updated_at on bean_photos;
drop trigger if exists grinder_calibration_set_updated_at on grinder_calibration;
drop trigger if exists user_gear_set_updated_at on user_gear;
drop trigger if exists drippers_set_updated_at on drippers;
drop trigger if exists grinders_set_updated_at on grinders;
drop trigger if exists user_identities_set_updated_at on user_identities;
drop trigger if exists app_users_set_updated_at on app_users;
drop trigger if exists beans_set_updated_at on beans;
drop trigger if exists preferences_set_updated_at on preferences;
drop trigger if exists feedback_set_updated_at on feedback;
drop trigger if exists recipes_set_updated_at on recipes;
drop function if exists set_updated_at();
