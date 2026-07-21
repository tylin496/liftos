-- Re-add health_metrics.steps, plus an `active_energy_estimated` flag (2026-07-21).
--
-- steps was dropped in 0008 as dead weight (ingested, never read). It comes back
-- with a consumer this time: when the Apple Watch isn't worn, HealthKit reports
-- an absurdly low Active Energy (0/3/6/15/23 kcal) that is a data gap, not a
-- real rest day. The iPhone still counts steps, so those days get a conservative
-- step-derived Active Energy instead of being averaged in at ~0.
--
-- active_energy_estimated marks a row whose active_energy_kcal was DERIVED from
-- steps rather than measured. Sum-style readers (weekly active total, active
-- target) count it — an estimate beats a hole there. Rate/trait readers that
-- calibrate targets (TDEE windows, day-type baselines) exclude it: an estimate
-- must never move the number the cut deficit is built on.
alter table public.health_metrics
  add column if not exists steps integer,
  add column if not exists active_energy_estimated boolean not null default false;
