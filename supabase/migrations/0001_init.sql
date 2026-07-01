-- LiftOS initial schema
-- Single source of truth for Nutrition, Training, and Health (Apple Health).
-- Every table is scoped to the signed-in user via Row Level Security so the
-- browser can talk to Supabase directly with the anon key.

-- ───────────────────────────── helpers ─────────────────────────────
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- ─────────────────────────── nutrition ─────────────────────────────
create table public.nutrition_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  entry_date    date not null,
  calories      integer,
  protein       numeric(6, 1),
  -- snapshot of the plan in effect on this day
  tdee          integer,
  calorie_target  integer,
  protein_target  integer,
  deficit_target  integer,
  cut_phase_index integer,
  cut_phase_name  text,
  cut_start_date  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, entry_date)
);

create table public.nutrition_config (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  tdee            integer not null default 2705,
  protein_target  integer not null default 180,
  -- per-phase deficits [aggressive, moderate, cruise, maintenance]
  phase_deficits  jsonb not null default '[805, 655, 455, 150]'::jsonb,
  active_phase_index integer not null default 1,
  cut_start_date  date,
  updated_at      timestamptz not null default now()
);

-- ──────────────────────────── training ─────────────────────────────
create table public.exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  split         text not null check (split in ('push', 'pull', 'legs')),
  slug          text not null,            -- stable id e.g. 'bench-press'
  name          text not null,
  target        text,                     -- rep target hint e.g. '5-8 × 3'
  note          text,
  image_url     text,
  archived      boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, slug)
);

create table public.training_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  exercise_slug text not null,
  log_date      date not null,
  raw           text,                     -- original notation e.g. '100*8'
  reps          text,
  weight_kg     numeric(7, 2),
  unit          text not null default 'kg',
  note          text,
  kind          text not null default 'normal' check (kind in ('normal', 'assisted')),
  assistance    numeric(7, 2),            -- assisted machines
  bodyweight    numeric(6, 2),
  created_at    timestamptz not null default now()
);
create index on public.training_logs (user_id, exercise_slug, log_date);

-- ───────────────────────────── health ──────────────────────────────
-- Fed by the iOS Shortcut → Edge Function. One row per day.
create table public.health_metrics (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  metric_date        date not null,
  weight_kg          numeric(6, 2),
  body_fat_pct       numeric(5, 2),
  active_energy_kcal integer,
  resting_energy_kcal integer,
  steps              integer,
  exercise_minutes   integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, metric_date)
);

-- ───────────────────────── updated_at triggers ─────────────────────
create trigger trg_nutrition_entries_updated before update on public.nutrition_entries
  for each row execute function public.set_updated_at();
create trigger trg_nutrition_config_updated before update on public.nutrition_config
  for each row execute function public.set_updated_at();
create trigger trg_exercises_updated before update on public.exercises
  for each row execute function public.set_updated_at();
create trigger trg_health_metrics_updated before update on public.health_metrics
  for each row execute function public.set_updated_at();

-- ────────────────────────── Row Level Security ─────────────────────
-- Identical policy on every table: a row is visible/writable only by its owner.
do $$
declare t text;
begin
  foreach t in array array[
    'nutrition_entries', 'nutrition_config', 'exercises',
    'training_logs', 'health_metrics'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($p$
      create policy "own rows - select" on public.%I
        for select using (auth.uid() = user_id);
    $p$, t);
    execute format($p$
      create policy "own rows - insert" on public.%I
        for insert with check (auth.uid() = user_id);
    $p$, t);
    execute format($p$
      create policy "own rows - update" on public.%I
        for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
    $p$, t);
    execute format($p$
      create policy "own rows - delete" on public.%I
        for delete using (auth.uid() = user_id);
    $p$, t);
  end loop;
end $$;
