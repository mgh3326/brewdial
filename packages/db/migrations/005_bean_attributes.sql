-- Up Migration

-- ROB-654: structured bean attributes + taste-based recommendation (v1, agent-first).
-- DB stores INPUTS only (bean attributes + user signals); derived taste profile / ranking
-- / match reasons are computed at read time by the MCP agent. House style: text + CHECK
-- (never pg enum), all DDL idempotent.

-- ── beans: nullable structured attribute columns ─────────────────────────────
-- New TABLE is intentionally avoided — these hang off the shared beans registry.
-- Variety / altitude / blend ratio / sweetness stay in the free-text notes (YAGNI).
alter table beans add column if not exists roast_level_ord  smallint;  -- 1 (light) .. 5 (dark)
alter table beans add column if not exists agtron_min        integer;  -- Agtron range (anchors roast_level_ord when present)
alter table beans add column if not exists agtron_max        integer;
alter table beans add column if not exists acidity           smallint; -- 1 (low) .. 5 (high)
alter table beans add column if not exists body              smallint; -- 1 (light) .. 5 (heavy)
alter table beans add column if not exists decaf             boolean;
alter table beans add column if not exists flavor_categories text[];   -- SCA flavor wheel inner 9
alter table beans add column if not exists attrs_source      text;     -- provenance of the attributes
alter table beans add column if not exists source_url        text;     -- roaster/product page the attrs came from
alter table beans add column if not exists attrs_notes       text;     -- original roaster notation, verbatim (drift detection vs find_or_create_bean coalesce upsert)

-- CHECK constraints — guarded ALTER (idempotent). text + CHECK, never pg enum.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'beans_roast_level_ord_chk') then
    alter table beans add constraint beans_roast_level_ord_chk
      check (roast_level_ord is null or roast_level_ord between 1 and 5);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'beans_acidity_chk') then
    alter table beans add constraint beans_acidity_chk
      check (acidity is null or acidity between 1 and 5);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'beans_body_chk') then
    alter table beans add constraint beans_body_chk
      check (body is null or body between 1 and 5);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'beans_agtron_chk') then
    alter table beans add constraint beans_agtron_chk
      check (
        (agtron_min is null or agtron_min between 0 and 150)
        and (agtron_max is null or agtron_max between 0 and 150)
        and (agtron_min is null or agtron_max is null or agtron_max >= agtron_min)
      );
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'beans_flavor_categories_chk') then
    alter table beans add constraint beans_flavor_categories_chk
      check (
        flavor_categories is null
        or flavor_categories <@ array['fruity','floral','sweet','nutty_cocoa','spices','roasted','cereal','sour_fermented','green']::text[]
      );
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'beans_attrs_source_chk') then
    alter table beans add constraint beans_attrs_source_chk
      check (attrs_source is null or attrs_source in ('roaster_page','ai_extracted','manual'));
  end if;
end $$;

-- ── feedback ↔ bean linkage repair ───────────────────────────────────────────
-- Mirrors recipes_link_bean, but feedback has NO bean_snapshot column, so bean_id
-- is derived from the parent recipe (feedback.recipe_code → recipes.bean_id).
-- FK on delete set null keeps feedback rows if a bean is ever removed.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_bean_id_fkey') then
    alter table feedback add constraint feedback_bean_id_fkey
      foreign key (bean_id) references beans(id) on delete set null;
  end if;
end $$;
create index if not exists feedback_bean_id_idx on feedback (bean_id) where bean_id is not null;

-- Backfill existing feedback.bean_id from the parent recipe (valid bean refs only).
update feedback f
   set bean_id = r.bean_id
  from recipes r
 where r.code = f.recipe_code
   and f.bean_id is null
   and r.bean_id is not null
   and exists (select 1 from beans b where b.id = r.bean_id);

-- before-insert trigger: auto-link future feedback to its recipe's bean.
-- exists() guard keeps the FK safe even if recipes.bean_id is ever dangling.
create or replace function feedback_link_bean()
returns trigger language plpgsql security definer as $$
begin
  if new.bean_id is null then
    select r.bean_id into new.bean_id
      from recipes r
     where r.code = new.recipe_code
       and r.bean_id is not null
       and exists (select 1 from beans b where b.id = r.bean_id);
  end if;
  return new;
end $$;
drop trigger if exists feedback_link_bean_trg on feedback;
create trigger feedback_link_bean_trg before insert on feedback
  for each row execute function feedback_link_bean();

-- ── bean_summaries view: append structured attributes ────────────────────────
-- create-or-replace can only APPEND columns; the original 10 keep their order/type.
-- IMPORTANT: this preserves the ROB-642 (004_owner_privacy) aggregate filters
-- (`and r.owner_id is null`) so private recipes still don't bump public bean cards —
-- we only append the new scoring columns on top.
create or replace view bean_summaries
  with (security_invoker = on) as
  select b.id, b.name, b.roaster, b.origin, b.process, b.roast_level, b.notes,
         count(r.code)     filter (where r.status = 'active' and r.owner_id is null) as recipe_count,
         max(r.created_at) filter (where r.status = 'active' and r.owner_id is null) as latest_recipe_at,
         coalesce(bool_or(r.created_by = 'agent') filter (where r.status = 'active' and r.owner_id is null), false) as has_ai,
         b.roast_level_ord, b.agtron_min, b.agtron_max, b.acidity, b.body,
         b.decaf, b.flavor_categories, b.attrs_source, b.source_url, b.attrs_notes
  from beans b
  left join recipes r on r.bean_id = b.id
  group by b.id;

-- Down Migration

-- Restore the 004_owner_privacy 10-column view (create-or-replace cannot drop columns).
-- Down reverts to the ROB-642 privacy-preserving definition, NOT the 002 original.
-- NOTE: the feedback.bean_id backfill is a data change and is intentionally NOT reverted.
drop view if exists bean_summaries;
create view bean_summaries
  with (security_invoker = on) as
  select b.id, b.name, b.roaster, b.origin, b.process, b.roast_level, b.notes,
         count(r.code)     filter (where r.status = 'active' and r.owner_id is null) as recipe_count,
         max(r.created_at) filter (where r.status = 'active' and r.owner_id is null) as latest_recipe_at,
         coalesce(bool_or(r.created_by = 'agent') filter (where r.status = 'active' and r.owner_id is null), false) as has_ai
  from beans b
  left join recipes r on r.bean_id = b.id
  group by b.id;

drop trigger if exists feedback_link_bean_trg on feedback;
drop function if exists feedback_link_bean();
drop index if exists feedback_bean_id_idx;
alter table feedback drop constraint if exists feedback_bean_id_fkey;

alter table beans drop constraint if exists beans_attrs_source_chk;
alter table beans drop constraint if exists beans_flavor_categories_chk;
alter table beans drop constraint if exists beans_agtron_chk;
alter table beans drop constraint if exists beans_body_chk;
alter table beans drop constraint if exists beans_acidity_chk;
alter table beans drop constraint if exists beans_roast_level_ord_chk;
alter table beans drop column if exists attrs_notes;
alter table beans drop column if exists source_url;
alter table beans drop column if exists attrs_source;
alter table beans drop column if exists flavor_categories;
alter table beans drop column if exists decaf;
alter table beans drop column if exists body;
alter table beans drop column if exists acidity;
alter table beans drop column if exists agtron_max;
alter table beans drop column if exists agtron_min;
alter table beans drop column if exists roast_level_ord;
