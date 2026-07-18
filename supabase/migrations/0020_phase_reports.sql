-- Phase retrospective reports — the one-time settled summary written when a
-- cut/bulk phase ENDS (the intake goal crosses into a different phase band).
-- A phase close is a settled verdict, like a logged day: the report is
-- generated once at close time from the data then in force and never
-- recomputed. Upsert key (user_id, phase_kind, start_date) makes the close
-- idempotent — flipping the intake back and forth around a band edge just
-- rewrites the same report, never duplicates it.
-- Apply manually via the Supabase Dashboard SQL editor (this repo does not
-- use `supabase db push`). Safe to re-run.

create table if not exists public.phase_reports (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  phase_kind          text not null check (phase_kind in ('cut', 'bulk')),
  start_date          date not null,   -- frozen baseline (cut_start_date / bulk_start_date)
  end_date            date not null,   -- the day the intake goal left the phase band

  -- ── Span & adherence (from day-stamped entry snapshots) ──
  active_days         integer not null,
  logged_days         integer not null,
  adherent_days       integer not null,  -- isAdherentState against each day's OWN target
  avg_calories        integer,
  avg_protein         integer,
  avg_calorie_target  integer,
  avg_deficit_target  integer,           -- signed (− = surplus target)

  -- ── Body composition endpoints (14-day smoothed, matching the baselines) ──
  start_weight_kg     numeric,
  end_weight_kg       numeric,
  start_body_fat_pct  numeric,
  end_body_fat_pct    numeric,
  observed_rate_kg_wk numeric,           -- signed, − = loss
  planned_rate_kg_wk  numeric,           -- from avg_deficit_target (7700 kcal/kg)

  -- ── TDEE calibration trajectory (descriptive, never gates decisions) ──
  assumed_tdee        integer,           -- avg of the entries' day-stamped tdee
  measured_tdee       integer,           -- energy-balance back-calc over the phase

  -- ── Training volume retention (trailing-4-week avg, same computeWeeklyVolume) ──
  volume_start_kg_wk  numeric,           -- as of ~4 weeks into the phase
  volume_end_kg_wk    numeric,           -- as of the phase's last day

  created_at          timestamptz not null default now(),
  unique (user_id, phase_kind, start_date)
);

-- Row Level Security — same shape as every other shared table: owner reads own
-- rows, a whitelisted viewer reads the owner's rows; writes stay owner-only.
alter table public.phase_reports enable row level security;

create policy "read - own or shared" on public.phase_reports
  for select using (
    case
      when (select public.is_owner()) then (select auth.uid()) = user_id
      else user_id = (select public.owner_id())
    end
  );
create policy "own rows - insert" on public.phase_reports
  for insert with check (auth.uid() = user_id);
create policy "own rows - update" on public.phase_reports
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows - delete" on public.phase_reports
  for delete using (auth.uid() = user_id);
