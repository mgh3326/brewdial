-- Up Migration
create table if not exists brews (
  xbloom_brew_id text primary key,
  brewed_at timestamptz not null,
  brew_time_sec double precision not null,
  recipe_name text not null,
  xbloom_recipe_id text,
  total_water_ml double precision not null,
  final_cup_g double precision not null,
  retention_g double precision not null,
  pour_end_sec integer not null,
  cup_at_pour_end_g double precision not null,
  drawdown_sec integer not null,
  early_drawdown_g_per_sec double precision not null,
  recipe_snapshot jsonb not null,
  curve jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists brews_xbloom_recipe_brewed_at_idx on brews (xbloom_recipe_id, brewed_at desc);
create index if not exists brews_brewed_at_idx on brews (brewed_at desc);

create table if not exists xbloom_recipe_links (
  xbloom_recipe_id text primary key,
  recipe_code text not null references recipes(code) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Down Migration
drop table if exists xbloom_recipe_links;
drop table if exists brews;
