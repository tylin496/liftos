-- Fix: shared viewers couldn't see the owner's Nutrition Recommendation card.
--
-- `nutrition_evaluations` (0008) shipped with the plain owner-only SELECT policy
-- (auth.uid() = user_id), created AFTER 0002_shared_read_access wired the
-- "read - own or shared" policy onto the other five tables. So a viewer reading
-- this table saw no owner row — getNutritionState() returned null (or the
-- viewer's own stale/empty row), and the Insight card fell back to its
-- low-confidence "Not enough confident data yet" default instead of the owner's
-- real evaluation.
--
-- Give it the same SELECT shape as every other shared table: owner sees own row,
-- viewer sees the owner's row (read-only). Insert/update/delete stay owner-only
-- (untouched from 0008), so a viewer still can't write. The case structure
-- returns exactly ONE row per session, which .maybeSingle() requires.
--
-- Apply manually in the Supabase Dashboard SQL Editor (this repo does not use
-- `supabase db push`). Safe to re-run.

drop policy if exists "own rows - select" on public.nutrition_evaluations;
drop policy if exists "read - own or shared" on public.nutrition_evaluations;

create policy "read - own or shared" on public.nutrition_evaluations
  for select using (
    case
      when (select public.is_owner()) then (select auth.uid()) = user_id
      else user_id = (select public.owner_id())
    end
  );
