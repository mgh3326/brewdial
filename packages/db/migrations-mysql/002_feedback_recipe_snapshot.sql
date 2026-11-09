-- Pin feedback to the recipe state present when the feedback was recorded.
alter table feedback
  add column recipe_version int null,
  add column recipe_snapshot json null;
