-- Track when a day's nutrition was exported to Apple Health, so re-running
-- the "Dietary Sync" Shortcut never double-logs Dietary Energy / Protein
-- (Apple Health's Log Health Sample is append-only). The GET branch of
-- /api/health-sync stamps this the first time it hands back a day's values,
-- and returns nulls on every later request for that date.
alter table public.nutrition_entries
  add column if not exists dietary_exported_at timestamptz;
