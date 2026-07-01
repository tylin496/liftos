-- Nutrition Evaluation (v2) — the single persisted "nutrition state" per user.
-- Holds the always-current Evaluation + its Diagnostics, plus the derived
-- Recommendation, as separate columns on one row. Recomputed whenever new data
-- arrives (weight sync / entry save); the Recommendation is derived from the
-- Evaluation, so every screen reads one source of truth instead of recomputing.
-- One row per user (user_id PK), mirroring public.nutrition_config.

create table public.nutrition_evaluations (
  user_id            uuid primary key references auth.users (id) on delete cascade,

  -- ── Evaluation (describes reality; overwritten freely on each recompute) ──
  status             text not null check (status in ('below_target', 'on_target', 'above_target')),
  observed_rate      real not null,          -- kg/week, negative = loss
  target_min         real not null,          -- positive loss magnitude, kg/week
  target_max         real not null,
  confidence         text not null check (confidence in ('low', 'medium', 'high')),
  evaluated_at       timestamptz not null,

  -- ── Diagnostics (explains why; descriptive only, never a judgment input) ──
  estimated_tdee     integer,
  estimated_intake   integer,
  intake_difference  integer,
  calorie_target     integer,
  cut_mode           text,
  window_days        integer,
  weight_data_points integer,

  -- ── Recommendation (derived from the Evaluation; the action to surface) ──
  rec_source         text,
  rec_priority       integer,
  rec_title          text,
  rec_subtitle       text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_nutrition_evaluations_updated before update on public.nutrition_evaluations
  for each row execute function public.set_updated_at();

-- Row Level Security — owner-only, same policy shape as every other table.
alter table public.nutrition_evaluations enable row level security;

create policy "own rows - select" on public.nutrition_evaluations
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on public.nutrition_evaluations
  for insert with check (auth.uid() = user_id);
create policy "own rows - update" on public.nutrition_evaluations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows - delete" on public.nutrition_evaluations
  for delete using (auth.uid() = user_id);
