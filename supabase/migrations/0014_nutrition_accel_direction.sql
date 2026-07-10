-- The Nutrition Insight pace arrow shows the loss RATE's TREND — is the loss
-- speeding up ("faster") or slowing toward a plateau ("slowing")? — a
-- second-order read, separate from the 21-day observed rate the card already
-- stores. It's derived at recompute time (weightAcceleration over 14+14d
-- windows) and persisted here so every screen reads it from the single
-- evaluation row instead of refetching weight metrics. Null = no clear trend
-- (holding inside the deadband, too few readings, or prior window not a loss).
--
-- Apply manually in the Supabase Dashboard SQL editor (this project's migration
-- history is not driven by `supabase db push`).

alter table public.nutrition_evaluations
  add column if not exists accel_direction text;
