-- Up Migration

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

-- v2 IDENTITY MERGE — pure DATA op (service role / Edge Function only).
-- ABSORB-AUTHORIZED: the Edge Function must have proven, in the same verified
-- session, that the caller controls each source identity before passing it.
-- B3 NOTE: this runs under the service role AND is SECURITY DEFINER; its
-- `update recipes set owner_id = p_keep` is permitted because (a) service_role
-- satisfies bd_owner_write_allowed via JWT claims, and (b) belt-and-suspenders,
-- it also sets the txn-local owner-write flag so the recipes guard never blocks it.
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

-- Down Migration

drop function if exists merge_app_users(uuid, uuid);
drop function if exists resolve_app_user(text, text);
