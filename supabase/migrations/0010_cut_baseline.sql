-- Fixed starting line for the current cut. Cut Progress used to derive its
-- start from a rolling window (the first 14 days of the last 60 days of data),
-- so the starting point crept forward every day and progress read artificially
-- low. These columns pin the start once: a chosen date and the smoothed body
-- composition at that date. The destination (goal weight) stays adaptive; only
-- the origin is frozen. Null = no cut anchored yet → falls back to the old
-- data-derived start.
alter table nutrition_config
  add column if not exists cut_start_date date,
  add column if not exists cut_start_body_fat_pct numeric,
  add column if not exists cut_start_weight numeric;
