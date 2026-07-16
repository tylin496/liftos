-- 0018: per-exercise muscle-group override.
--
-- Muscle tagging is inferred from name/slug/split (muscleGroup.ts) with no user
-- input. This column exists ONLY to correct the rare misclassification: null
-- means "trust the inference" (the overwhelmingly common case); a value pins
-- the exercise's primary limiting muscle and short-circuits inference.
--
-- Apply manually via the Supabase Dashboard SQL editor (migrations are not
-- pushed from the CLI in this project).

alter table public.exercises
  add column if not exists muscle_group_override text default null;

-- Keep the value space in lockstep with MuscleGroup in muscleGroup.ts
-- ("unknown" is deliberately not storable — clearing the override is how you
-- say "don't know", and inference never needs to be forced to unknown).
alter table public.exercises
  add constraint exercises_muscle_group_override_check
  check (
    muscle_group_override is null or muscle_group_override in (
      'chest', 'back', 'shoulders', 'biceps', 'triceps',
      'quads', 'hamstrings', 'glutes', 'calves', 'abs'
    )
  );
