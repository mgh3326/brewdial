-- Registry rows for the xBloom Studio grinder, the Omni Dripper 2 and the V60 Neo 01.
-- Idempotent: a name that already exists (any case) is left unchanged, so re-running
-- this file changes nothing and never fails on an existing row.
-- Only values with a cited source are set. Everything else stays null or the column
-- default. Sources are listed in the PR body.

insert into grinders (name, stepless, notes) values
  ('xBloom Studio', false, 'Built-in grinder of the xBloom Studio. Recipes record its grind setting as clicks.')
on duplicate key update name = name;

insert into drippers (name, class, notes) values
  ('Omni Dripper 2', 'bed_restricted', 'Dripper used with the xBloom Studio. xBloom lists a faster flow rate for it.'),
  ('V60 Neo 01', 'bed_restricted', 'Hario V60 Neo size 01, made in Japan. Body PCT resin (Tritan), base silicone rubber. 72 ribs converging into 9 at the base. Hario describes faster extraction.')
on duplicate key update name = name;
