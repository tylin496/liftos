-- Milestone feedback (round-weight achievements) fires for COMPOUND lifts only —
-- machine isolations load heavy (Leg Curl 102kg, Pec Deck 87.5kg) and would spam
-- milestones on a weight threshold. There's no reliable heuristic (machines lift
-- heavy), so compound is an explicit per-exercise flag.
--
-- Apply manually in the Supabase Dashboard SQL editor (this project's migration
-- history is not driven by `supabase db push`).

alter table public.exercises
  add column if not exists compound boolean not null default false;

-- Seed the obvious barbell / bodyweight compounds by name (case-insensitive), so
-- milestones work before any editor toggle exists. Matches a superset of the
-- current roster plus common compounds, so future-added lifts get tagged too.
-- Adjust to taste — this only sets the initial value; the flag is editable after.
update public.exercises set compound = true
where lower(name) in (
  'bench press', 'incline bench press', 'squat', 'front squat', 'deadlift',
  'rdl', 'romanian deadlift', 'low row', 'barbell row', 'pendlay row',
  'overhead press', 'ohp', 'push press', 'assisted pull-up', 'assisted pullup',
  'pull-up', 'pullup', 'chin-up', 'dip'
);
