-- Nutrition Evaluation — persist the target's tenure alongside the diagnostics.
-- `days_on_target` = trailing consecutive days logged at the *current* calorie
-- target (resets to 0 when the target changes). It already fed the confidence
-- score; persisting it lets the Insight card explain *why* confidence is capped
-- ("Low because this target has only been active for 7 days") without recomputing
-- from raw entries on the client. Nullable so pre-0009 reads degrade gracefully.

alter table public.nutrition_evaluations
  add column days_on_target integer;
