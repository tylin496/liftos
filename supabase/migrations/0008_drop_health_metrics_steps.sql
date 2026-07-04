-- Drop the health_metrics.steps column (2026-07-05).
-- Steps was ingested from the Apple Health Shortcut but never surfaced in the
-- app — no chart, no metric card, no analysis consumed it. Removed from the
-- Shortcut ingestion (supabase/functions/health-sync), the export, the metric
-- key unions, and the generated types; drop the now-dead column to match.
alter table public.health_metrics
  drop column if exists steps;
