-- LiftOS shared read-only access
-- Lets whitelisted Google accounts READ the owner's data. The owner keeps full
-- read/write; viewers are read-only (insert/update/delete policies are left
-- untouched, so a viewer's session can never write to the owner's rows).
--
-- Apply manually in the Supabase Dashboard SQL Editor (this repo does not use
-- `supabase db push`).

-- ───────────────────────── owner / viewer helpers ──────────────────────────

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

-- Allowlist of emails permitted to view the owner's data.
create table if not exists public.shared_viewers (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.shared_viewers enable row level security;

-- Only the owner can see / manage the allowlist.
drop policy if exists "owner manages viewers" on public.shared_viewers;
create policy "owner manages viewers" on public.shared_viewers
  for all
  using (public.is_owner())
  with check (public.is_owner());

-- Is the current session on the allowlist? SECURITY DEFINER so the check can
-- read shared_viewers even though viewers have no direct read policy on it.
create or replace function public.is_shared_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shared_viewers
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

-- ──────────────── widen SELECT: viewers read the owner's rows ───────────────
-- A viewer sees ONLY the owner's rows (never their own leftover rows) so that
-- .single()/.maybeSingle() reads return exactly one dataset — the owner's. The
-- owner (and any non-viewer) sees only their own rows, unchanged. insert /
-- update / delete policies from 0001 are intentionally left as-is, so a viewer
-- can never write the owner's data.
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
            when public.is_shared_viewer() then user_id = public.owner_id()
            else auth.uid() = user_id
          end
        );
    $p$, t);
  end loop;
end $$;
