-- "Repeat last session" marker — the one-tap maintained-day button clones each
-- lift's last real numbers onto today so the day counts as trained (weekly
-- volume, split auto-advance, recency). But an identical clone carries no new
-- strength signal, and left unmarked it pollutes every per-lift history/PR/
-- trend read with a duplicate row. This flag lets those strength reads skip the
-- clones while volume/split/recency still count the session. Default false, so
-- every existing row (and every hand-typed set) reads as a real entry.
-- Apply manually via the Supabase Dashboard SQL editor (this repo does not use
-- `supabase db push`). Safe to re-run.

alter table public.training_logs
  add column if not exists repeated boolean not null default false;
