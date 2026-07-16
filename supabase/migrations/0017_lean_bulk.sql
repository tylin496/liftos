-- Lean Bulk phase: baseline snapshot + endpoint ceiling on nutrition_config.
-- Mirrors the cut baseline (0010): start is frozen once via a one-time
-- initializer card; bulk_bf_ceiling is the endpoint (bf14 >= ceiling ->
-- engine recommends starting the cut). Applied manually via the Supabase
-- Dashboard SQL editor.
alter table public.nutrition_config
  add column if not exists bulk_start_date date,
  add column if not exists bulk_start_weight numeric,
  add column if not exists bulk_start_body_fat_pct numeric,
  add column if not exists bulk_bf_ceiling numeric;
