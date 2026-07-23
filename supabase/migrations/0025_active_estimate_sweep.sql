-- Nightly step-floor sweep for health_metrics (2026-07-23).
--
-- The step-floor / active_energy_estimated guard (0024) only runs inside the
-- health-sync Edge Function, i.e. only when a day is (re-)POSTed. A watch-off
-- day that the nightly Shortcut never re-sends — phone off, Shortcut error,
-- travel — keeps active_energy_kcal = null forever and silently drops out of
-- every average, exactly the hole 0024 was meant to close. (This is how ~15
-- pre-0024 days ended up null until a manual backfill on 2026-07-23.)
--
-- This is the fail-safe: a pg_cron job that re-applies the SAME floor the Edge
-- Function uses (34 kcal / 1000 steps, >=1000 steps, past days only) to any row
-- that still has steps but no active reading. It is a FLOOR, not an estimate,
-- and deliberately biased low — see docs/HEALTH-SYNC.md.
--
-- Idempotent by construction: the `active_energy_kcal is null` guard means a
-- row is touched at most once, and re-running cron.schedule with the same job
-- name replaces the existing schedule rather than duplicating it. It never
-- overwrites a measured value, and never touches the live today-row (compared
-- in Asia/Taipei, the same clock the Edge Function's today-check uses).
--
-- NOTE: pg_cron can only be enabled in the `postgres` database. If the
-- `create extension` below errors on permissions, enable it once via the
-- Dashboard (Database → Extensions → pg_cron) and re-run from the cron.schedule
-- call down.

create extension if not exists pg_cron;

-- 0 20 * * * UTC = 04:00 Asia/Taipei — after the nightly Shortcut has written
-- yesterday's finished row, so the sweep only ever mops up days it missed.
select cron.schedule(
  'active-energy-step-floor-sweep',
  '0 20 * * *',
  $sweep$
    update public.health_metrics
    set active_energy_kcal = round(0.034 * steps)::int,
        active_energy_estimated = true,
        updated_at = now()
    where active_energy_kcal is null
      and steps >= 1000
      and metric_date < (now() at time zone 'Asia/Taipei')::date;
  $sweep$
);

-- Verify / operate:
--   select jobid, jobname, schedule, active from cron.job;
--   select status, return_message, start_time
--     from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname = 'active-energy-step-floor-sweep')
--     order by start_time desc limit 5;
--   select cron.unschedule('active-energy-step-floor-sweep');   -- to remove
