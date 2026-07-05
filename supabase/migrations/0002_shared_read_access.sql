-- LiftOS shared read-only access
--
-- Login is gated at Google: the OAuth consent screen is in "Testing" mode, so
-- only listed test users can sign in at all. Anyone who successfully
-- authenticates is therefore already approved — there is no separate app-level
-- allowlist. RLS only has to decide owner vs. viewer:
--   owner  → their own rows (read/write, unchanged)
--   viewer → the owner's rows, READ-ONLY
--
-- The insert/update/delete policies from 0001 are left untouched, so a viewer
-- can never write the owner's data. Apply manually in the Supabase Dashboard
-- SQL Editor (this repo does not use `supabase db push`).

-- ───────────────────────────── owner identity ──────────────────────────────

-- The single data owner, resolved email -> auth.users.id. SECURITY DEFINER so
-- it can read auth.users regardless of who is calling.
create or replace function public.owner_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id from auth.users
  where lower(email) = lower('tylin496@gmail.com')
  limit 1
$$;

-- Is the current session the owner? (reads the JWT email claim; no table access)
create or replace function public.is_owner()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = lower('tylin496@gmail.com')
$$;

-- ──────────────── SELECT: owner sees own rows, viewers see owner's ──────────
do $$
declare t text;
begin
  foreach t in array array[
    'nutrition_entries', 'nutrition_config', 'exercises',
    'training_logs', 'health_metrics'
  ]
  loop
    execute format('drop policy if exists "own rows - select" on public.%I;', t);
    execute format('drop policy if exists "read - own or shared" on public.%I;', t);
    execute format($p$
      create policy "read - own or shared" on public.%I
        for select using (
          case
            when public.is_owner() then auth.uid() = user_id
            else user_id = public.owner_id()
          end
        );
    $p$, t);
  end loop;
end $$;

-- ─────────── retire the old data-layer allowlist (login gating replaced it) ──
-- Safe to re-run: these drop the shared_viewers table + helper introduced by an
-- earlier version of this migration. Google test-user gating is the allowlist now.
drop function if exists public.is_shared_viewer();
drop policy if exists "owner manages viewers" on public.shared_viewers;
drop table if exists public.shared_viewers;
