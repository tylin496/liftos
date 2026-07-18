-- Athlete sex — needed to pick the correct strength-standard thresholds
-- (the Beginner/Novice/Intermediate/Advanced/Elite bands differ materially by
-- sex, especially on upper-body lifts). Nullable: the strength-level read only
-- appears once it's set (Settings → About you), so an unset row simply shows no
-- level rather than assuming one. No other feature reads it.
-- Apply manually via the Supabase Dashboard SQL editor (this repo does not use
-- `supabase db push`). Safe to re-run.

alter table public.nutrition_config
  add column if not exists sex text check (sex in ('male', 'female'));
