-- "Bonus set" marker — a real lift logged outside a full session of its split
-- (e.g. a lone rest-day lateral raise). The row is a genuine strength record,
-- so every per-lift read (history, PR, e1RM, trend) keeps it. But the day must
-- NOT read as a trained session of the split: weekly volume counts only the
-- logged set (no roster carry-forward), the split rotation doesn't advance,
-- and recovery/day-type reads still see a rest day. Default false, so every
-- existing row (and every ordinary set) reads as part of a real session.
-- Apply manually via the Supabase Dashboard SQL editor (this repo does not use
-- `supabase db push`). Safe to re-run.

alter table public.training_logs
  add column if not exists bonus boolean not null default false;
