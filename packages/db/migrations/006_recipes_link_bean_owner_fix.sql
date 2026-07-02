-- Up Migration

-- ROB-656: recipes_link_bean must branch on the recipe's ACTUAL ownership
-- (new.owner_id), NOT on the bd.owner_write_ok permission flag.
--
-- 004_owner_privacy (ROB-642 C5) keyed match-only on bd_owner_write_allowed(),
-- assuming that flag marks "private owned writes". But the deployed code also sets
-- bd.owner_write_ok='on' in insertAgentRecipe (to let the guard permit
-- created_by='agent'), so agent (PUBLIC/official) recipes were wrongly denied bean
-- auto-creation for NEW beans (bean_id left NULL). owner_id is the true signal:
--   owner_id NOT NULL (private owned save)     → find_bean_match   (never create/overwrite a global bean; preserves C5 privacy)
--   owner_id NULL     (agent / anon PUBLIC)    → find_or_create_bean (enrich the shared registry)
--
-- Safe ordering: the guard trigger recipes_guard_owner_immutable fires BEFORE this
-- trigger (BEFORE-INSERT triggers run in name order; 'recipes_guard_...' < 'recipes_link_...'),
-- so new.owner_id is already finalized (forced NULL for non-owner-writers) when read here.
create or replace function recipes_link_bean()
returns trigger language plpgsql security definer as $$
begin
  if new.bean_id is null and new.bean_snapshot is not null then
    if new.owner_id is not null then
      new.bean_id := find_bean_match(new.bean_snapshot);
    else
      new.bean_id := find_or_create_bean(new.bean_snapshot);
    end if;
  end if;
  return new;
end $$;

-- Down Migration

-- Restore the 004_owner_privacy (flag-based) definition.
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
