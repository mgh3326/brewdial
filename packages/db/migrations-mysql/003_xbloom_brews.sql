create table brews (
  xbloom_brew_id varchar(32) not null primary key,
  brewed_at datetime(6) not null,
  brew_time_sec double not null,
  recipe_name text not null,
  xbloom_recipe_id varchar(32),
  total_water_ml double not null,
  final_cup_g double not null,
  retention_g double not null,
  pour_end_sec int not null,
  cup_at_pour_end_g double not null,
  drawdown_sec int not null,
  early_drawdown_g_per_sec double not null,
  recipe_snapshot json not null,
  curve json not null,
  created_at datetime(6) not null default (utc_timestamp(6)),
  key brews_xbloom_recipe_brewed_at_idx (xbloom_recipe_id, brewed_at desc),
  key brews_brewed_at_idx (brewed_at desc)
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;

create table xbloom_recipe_links (
  xbloom_recipe_id varchar(32) not null primary key,
  recipe_code varchar(64) not null,
  created_at datetime(6) not null default (utc_timestamp(6)),
  updated_at datetime(6) not null default (utc_timestamp(6)),
  constraint xbloom_recipe_links_recipe_fk foreign key (recipe_code) references recipes(code) on delete cascade
) engine = InnoDB default charset = utf8mb4 collate = utf8mb4_0900_as_cs;
