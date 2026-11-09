-- Up Migration

-- Pin feedback to the recipe state present when the feedback was recorded.
alter table feedback add column if not exists recipe_version integer;
alter table feedback add column if not exists recipe_snapshot jsonb;

-- Down Migration
alter table feedback drop column if exists recipe_snapshot;
alter table feedback drop column if exists recipe_version;
