-- Fixed starting line for the current cut.
--
-- Cut Progress measures against a persisted baseline on nutrition_config:
-- cut_start_date (already exists from 0001_init) plus the smoothed body
-- composition snapshotted at that date. The baseline is set ONCE via the in-app
-- one-time initializer (Overview) and thereafter only ever read — the persisted
-- value is never recomputed. To restart a cut later, edit these cut_start_*
-- fields directly; there is no in-app restart/reset/cancel flow.
--
-- cut_start_date is intentionally left null here so the initializer shows on
-- first entry; all three fields are filled in when the user creates the baseline.
alter table nutrition_config
  add column if not exists cut_start_body_fat_pct numeric,
  add column if not exists cut_start_weight numeric;
