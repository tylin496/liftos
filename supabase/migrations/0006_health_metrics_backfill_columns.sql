-- Backfill columns that were added to health_metrics directly via the
-- Supabase dashboard (out of band) and are missing from tracked migrations.
-- Types/nullability/defaults verified against the live production schema via
-- `supabase db query` against information_schema.columns (2026-07-02):
--   sleep_seconds        | integer | nullable | no default
--   resting_heart_rate   | integer | nullable | no default
--   hrv_sdnn_ms          | numeric | nullable | no default (unconstrained, no precision/scale)
-- No check constraints or column comments exist on these columns in production.
alter table public.health_metrics
  add column if not exists sleep_seconds integer,
  add column if not exists resting_heart_rate integer,
  add column if not exists hrv_sdnn_ms numeric;
