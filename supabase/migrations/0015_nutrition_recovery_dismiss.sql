-- Recovery directive dismiss. A *systemic* recovery dip (low readiness with
-- little recent training — i.e. sickness/travel, the one cause the app can't
-- infer) is the user's to explain away. When they dismiss it, we record the day
-- in `recovery_dismissed_at`; the recompute then suppresses the recovery rung
-- until training resumes (trainingLoad flips back to "trained") or a 10-day
-- safety cap passes, whichever comes first — so a genuinely lasting dip can
-- never be hidden indefinitely.
--
-- `rec_dismissible` mirrors, on the persisted recommendation, whether the
-- currently-surfaced directive offers that dismiss (only a systemic recovery
-- dip does). It drives the Overview System card's ✕ affordance without the UI
-- having to re-derive load context from the recommendation copy.
--
-- Apply manually in the Supabase Dashboard SQL editor (this project's migration
-- history is not driven by `supabase db push`).

alter table public.nutrition_evaluations
  add column if not exists recovery_dismissed_at date,
  add column if not exists rec_dismissible boolean;
