-- Assisted-machine flag on the exercise catalog (e.g. assisted pull-up). Drives
-- the default logging mode in the UI; per-set assisted data still lives on the log.
alter table public.exercises
  add column if not exists assisted_mode boolean not null default false;
