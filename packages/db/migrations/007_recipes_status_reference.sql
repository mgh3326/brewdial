-- Up Migration

-- #588: allow status='reference' for externally-sourced reference recipes
-- (xBloom chain 2/4). Widens the CHECK — a superset of the old value set, so
-- every existing row still satisfies it and no data rewrite is needed.
--
-- Idempotent by construction: drop-if-exists + re-add yields the same
-- constraint on a manual re-run; node-pg-migrate also records it in
-- pgmigrations and will not re-apply.
alter table recipes drop constraint if exists recipes_status_check;
alter table recipes add constraint recipes_status_check
  check (status in ('active','superseded','archived','test','reference'));

-- Down Migration

-- Restore the pre-007 value set. NOTE: fails while any status='reference'
-- row still exists — delete or re-status those rows before migrating down.
alter table recipes drop constraint if exists recipes_status_check;
alter table recipes add constraint recipes_status_check
  check (status in ('active','superseded','archived','test'));
