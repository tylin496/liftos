-- Fixes found via `supabase db advisors --linked` plus manual drift review
-- against the live production schema (2026-07-02).

-- 1. Duplicate unique index on nutrition_entries — `nutrition_entries_user_date_unique`
--    was added directly via the dashboard, out of band, and duplicates the
--    tracked constraint from 0001_init.sql (`unique (user_id, entry_date)`,
--    materialized as `nutrition_entries_user_id_entry_date_key`).
alter table public.nutrition_entries
  drop constraint if exists nutrition_entries_user_date_unique;

-- 2. Dead column — never selected/updated/upserted anywhere in the app.
--    Training age is now derived live from `training_start_date`
--    (see src/app/layout/SettingsSheet.tsx, trainingMonthsFromStart()).
alter table public.nutrition_config
  drop column if exists training_age_months;

-- 3. RLS Auth InitPlan (advisor: auth_rls_initplan) — `auth.uid()` was being
--    re-evaluated per row instead of once per query. Wrap in `(select ...)`
--    on every "own rows" policy across all 5 tables.
drop policy if exists "own rows - select" on public.exercises;
drop policy if exists "own rows - insert" on public.exercises;
drop policy if exists "own rows - update" on public.exercises;
drop policy if exists "own rows - delete" on public.exercises;
create policy "own rows - select" on public.exercises
  for select using ((select auth.uid()) = user_id);
create policy "own rows - insert" on public.exercises
  for insert with check ((select auth.uid()) = user_id);
create policy "own rows - update" on public.exercises
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows - delete" on public.exercises
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "own rows - select" on public.training_logs;
drop policy if exists "own rows - insert" on public.training_logs;
drop policy if exists "own rows - update" on public.training_logs;
drop policy if exists "own rows - delete" on public.training_logs;
create policy "own rows - select" on public.training_logs
  for select using ((select auth.uid()) = user_id);
create policy "own rows - insert" on public.training_logs
  for insert with check ((select auth.uid()) = user_id);
create policy "own rows - update" on public.training_logs
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows - delete" on public.training_logs
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "own rows - select" on public.nutrition_config;
drop policy if exists "own rows - insert" on public.nutrition_config;
drop policy if exists "own rows - update" on public.nutrition_config;
drop policy if exists "own rows - delete" on public.nutrition_config;
create policy "own rows - select" on public.nutrition_config
  for select using ((select auth.uid()) = user_id);
create policy "own rows - insert" on public.nutrition_config
  for insert with check ((select auth.uid()) = user_id);
create policy "own rows - update" on public.nutrition_config
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows - delete" on public.nutrition_config
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "own rows - select" on public.nutrition_entries;
drop policy if exists "own rows - insert" on public.nutrition_entries;
drop policy if exists "own rows - update" on public.nutrition_entries;
drop policy if exists "own rows - delete" on public.nutrition_entries;
create policy "own rows - select" on public.nutrition_entries
  for select using ((select auth.uid()) = user_id);
create policy "own rows - insert" on public.nutrition_entries
  for insert with check ((select auth.uid()) = user_id);
create policy "own rows - update" on public.nutrition_entries
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows - delete" on public.nutrition_entries
  for delete using ((select auth.uid()) = user_id);

drop policy if exists "own rows - select" on public.health_metrics;
drop policy if exists "own rows - insert" on public.health_metrics;
drop policy if exists "own rows - update" on public.health_metrics;
drop policy if exists "own rows - delete" on public.health_metrics;
create policy "own rows - select" on public.health_metrics
  for select using ((select auth.uid()) = user_id);
create policy "own rows - insert" on public.health_metrics
  for insert with check ((select auth.uid()) = user_id);
create policy "own rows - update" on public.health_metrics
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows - delete" on public.health_metrics
  for delete using ((select auth.uid()) = user_id);

-- 4. Function Search Path Mutable (advisor: function_search_path_mutable) —
--    pin search_path so the trigger function can't be hijacked by a
--    session-level search_path change.
alter function public.set_updated_at() set search_path = pg_catalog, public;

-- 5. Public Bucket Allows Listing (advisor: public_bucket_allows_listing) —
--    `exercise-images` is a public bucket (storage.buckets.public = true), so
--    object bytes are already served via the public URL route without going
--    through this RLS policy at all (see getPublicUrl() usage in
--    src/features/training/api.ts). The app never calls .list()/.download(),
--    so this policy only adds the ability to enumerate every filename in the
--    bucket via the storage API — drop it.
drop policy if exists "Public read access for exercise images" on storage.objects;
