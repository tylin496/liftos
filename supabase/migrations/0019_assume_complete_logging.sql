-- 0019: user assertion that the food log is complete.
--
-- tdeeCalibration pins a lone log-vs-sensor divergence on the food log
-- ("habitual under-reporting") — a prior that's right for most people and
-- wrong for a user who genuinely logs everything. true = drop that prior:
-- the divergence is left unattributed (likelyCause null) and the export
-- carries a possibleCauses list for the reader to weigh instead.
--
-- Apply manually via the Supabase Dashboard SQL editor (migrations are not
-- pushed from the CLI in this project).

alter table public.nutrition_config
  add column if not exists assume_complete_logging boolean not null default false;
