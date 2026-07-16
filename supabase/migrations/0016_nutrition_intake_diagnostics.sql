-- Persist the three diagnostics evaluate() computes but the row never stored:
-- `logged_intake` (windowed mean of logged calories, kcal/day), `intake_gap`
-- (estimated_intake − logged_intake, kcal/day) and `longest_gap` (longest
-- weigh-in gap inside the evaluation window, days). Without columns, rowToState
-- had to stub them (null/null/0) on every persisted read, and any consumer that
-- reprints diagnostics — the AI export — had to recompute them from live data
-- or print stubs beside a confidence built from the real numbers (the exact bug
-- fixed on 2026-07-16). Nullable so pre-0016 rows degrade to the old stubs
-- until the next recompute fills them.
--
-- Apply manually in the Supabase Dashboard SQL editor (this project's migration
-- history is not driven by `supabase db push`).

alter table public.nutrition_evaluations
  add column if not exists logged_intake integer,
  add column if not exists intake_gap integer,
  add column if not exists longest_gap integer;
