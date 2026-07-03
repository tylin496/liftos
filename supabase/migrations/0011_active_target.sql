-- Maintenance TDEE goal for the Active Target card (Health tab).
--
-- The user picks a total daily energy expenditure they want to hold (e.g.
-- 2,800 kcal). The Health tab back-solves the daily active-calorie target from
-- it: active_target = target_tdee − resting(30-day avg). Distinct from the
-- existing nutrition `tdee` column, which is the estimated maintenance baseline
-- used to derive the eat-to calorie budget — this is an aspirational expenditure
-- goal the user sets, not an estimate.
--
-- Null until the user sets a goal; the card shows a one-tap setup prompt while null.
alter table nutrition_config
  add column if not exists target_tdee integer;
