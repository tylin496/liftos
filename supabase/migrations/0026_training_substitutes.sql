-- "Substitute" marker — the machine was taken, so this set stood in for another
-- lift in the same session (e.g. a Cable Row done instead of the Low Row). The
-- row is a genuine strength record of the lift that was ACTUALLY performed, so
-- every per-lift read (history, PR, e1RM, trend, standards) keeps it. What
-- changes is weekly volume's carry-forward, on that date only:
--   * the substituted slug does NOT carry forward that day — it wasn't trained,
--     and unlike plain silence this is an explicit stand-in, so 沒記就是維持
--     must not fill it in (that would double-count the session's slot).
--   * the substitute's own volume counts once, attributed to the substituted
--     lift's split, and is NEVER carried forward to other days — an occasional
--     stand-in is not a roster member, so it must not inflate every later
--     session of that split.
-- Null (the default) = an ordinary set, so every existing row is unchanged.
-- Holds the substituted exercise's slug; no FK, matching exercise_slug's own
-- loose coupling (slugs are stable and an archived lift must stay referencable).
-- Apply manually via the Supabase Dashboard SQL editor (this repo does not use
-- `supabase db push`). Safe to re-run.

alter table public.training_logs
  add column if not exists substitutes text;
