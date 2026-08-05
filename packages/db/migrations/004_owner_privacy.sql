-- Up Migration

-- ROB-642 C4: bean_summaries must exclude owner-scoped (private) recipes from the
-- public aggregates, so a private save can't bump a public bean's card count /
-- has_ai / latest_recipe_at (activity oracle + count-vs-detail-list mismatch).
create or replace view bean_summaries
  with (security_invoker = on) as
  select b.id, b.name, b.roaster, b.origin, b.process, b.roast_level, b.notes,
         count(r.code)     filter (where r.status = 'active' and r.owner_id is null) as recipe_count,
         max(r.created_at) filter (where r.status = 'active' and r.owner_id is null) as latest_recipe_at,
         coalesce(bool_or(r.created_by = 'agent') filter (where r.status = 'active' and r.owner_id is null), false) as has_ai
  from beans b
  left join recipes r on r.bean_id = b.id
  group by b.id;

-- ROB-642 C5: match-only bean lookup for owned (private) recipe inserts. SELECTs an
-- existing bean by the (name, roaster) unique key; never inserts or updates beans.
create or replace function find_bean_match(snap jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := nullif(trim(snap->>'name'), '');
  v_roaster text := nullif(trim(snap->>'roaster'), '');
  v_id text;
begin
  if v_name is null then return null; end if;
  select id into v_id from beans
    where lower(name) = lower(v_name)
      and coalesce(lower(roaster), '') = coalesce(lower(v_roaster), '')
    limit 1;
  return v_id;
end $$;

-- ROB-642 C5: owned writes (bd.owner_write_ok set by insertManualRecipe's txn) link
-- to an existing public bean at most — never create or overwrite a global bean.
-- Public recipe inserts keep the enriching find_or_create_bean behavior.
create or replace function recipes_link_bean()
returns trigger language plpgsql security definer as $$
begin
  if new.bean_id is null and new.bean_snapshot is not null then
    if public.bd_owner_write_allowed() then
      new.bean_id := find_bean_match(new.bean_snapshot);
    else
      new.bean_id := find_or_create_bean(new.bean_snapshot);
    end if;
  end if;
  return new;
end $$;

-- Down Migration

-- Restore owner-agnostic aggregates (002 original).
create or replace view bean_summaries
  with (security_invoker = on) as
  select b.id, b.name, b.roaster, b.origin, b.process, b.roast_level, b.notes,
         count(r.code)     filter (where r.status = 'active') as recipe_count,
         max(r.created_at) filter (where r.status = 'active') as latest_recipe_at,
         coalesce(bool_or(r.created_by = 'agent') filter (where r.status = 'active'), false) as has_ai
  from beans b
  left join recipes r on r.bean_id = b.id
  group by b.id;

-- Restore the original owner-agnostic link trigger (002 original).
create or replace function recipes_link_bean()
returns trigger language plpgsql security definer as $$
begin
  if new.bean_id is null and new.bean_snapshot is not null then
    new.bean_id := find_or_create_bean(new.bean_snapshot);
  end if;
  return new;
end $$;

drop function if exists find_bean_match(jsonb);
