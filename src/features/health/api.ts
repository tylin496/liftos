import { supabase } from "@shared/lib/supabase";
import type { Database } from "@shared/lib/database.types";
import { computeTdeeWindows, type TdeeEstimate } from "./tdee";
import { computeActiveTarget, type ActiveTargetView } from "./activeTarget";
import { sanitizeMetrics } from "./math";
import { localDateStrDaysAgo } from "@shared/lib/date";

export type BodyMetric = Database["public"]["Tables"]["health_metrics"]["Row"];

function sinceDate(days: number): string {
  return localDateStrDaysAgo(days);
}

/** Last N days of Apple Health metrics, oldest → newest. RLS-scoped. */
async function fetchBodyMetrics(days = 90): Promise<BodyMetric[]> {
  const { data, error } = await supabase
    .from("health_metrics")
    .select("*")
    .gte("metric_date", sinceDate(days))
    .order("metric_date", { ascending: true });
  if (error) throw error;
  // Single read boundary: nulls out implausible body-fat samples so every
  // downstream consumer (Health page, Overview goal/lean-mass, TDEE, export)
  // treats the same days as "no reading" — a value that never reaches a chart
  // must never reach the engine or the export summary either.
  return sanitizeMetrics(data ?? []);
}

export interface HealthData {
  metrics: BodyMetric[];
  tdee: TdeeEstimate;
  tdeePrev: TdeeEstimate;
  /** User-set maintenance TDEE goal (null until configured). */
  targetTdee: number | null;
  /** Derived active-calorie target + pace, null until both goal and resting exist. */
  activeTarget: ActiveTargetView | null;
  /** Target weight-loss pace band (kg/wk, positive = loss) from the persisted
      nutrition evaluation — the same band Overview's corridor draws. Null when
      no evaluation exists yet or there's no active target (min === max). */
  weightTargetRange: { min: number; max: number } | null;
}

/** The evaluation's target pace band, read directly off the persisted row —
 *  never re-derived here (the nutrition engine owns that computation). */
async function fetchWeightTargetRange(): Promise<{ min: number; max: number } | null> {
  // Degrade gracefully (pre-migration / read failure → null): the corridor is
  // context on a chart, never worth breaking the page over.
  try {
    const { data, error } = await supabase
      .from("nutrition_evaluations")
      .select("target_min, target_max")
      .maybeSingle();
    if (error || !data || data.target_min === data.target_max) return null;
    return { min: data.target_min, max: data.target_max };
  } catch {
    return null;
  }
}

/** The maintenance TDEE goal the user wants to hold, from nutrition_config. */
async function fetchTargetTdee(): Promise<number | null> {
  const { data, error } = await supabase
    .from("nutrition_config")
    .select("target_tdee")
    .maybeSingle();
  if (error) throw error;
  return data?.target_tdee ?? null;
}

async function loadHealthData(days: number): Promise<HealthData> {
  // Fetch extra history so previous-period TDEE windows are covered.
  const fetchDays = Math.max(days, 60);
  const [allMetrics, targetTdee, weightTargetRange] = await Promise.all([
    fetchBodyMetrics(fetchDays),
    fetchTargetTdee(),
    fetchWeightTargetRange(),
  ]);

  const { tdee, tdeePrev } = computeTdeeWindows(allMetrics);
  const activeTarget = computeActiveTarget(allMetrics, targetTdee, tdee.avgResting);

  const cutoffDisplay = sinceDate(days);
  const metrics = allMetrics.filter((m) => m.metric_date >= cutoffDisplay);

  return { metrics, tdee, tdeePrev, targetTdee, activeTarget, weightTargetRange };
}

// Short-lived request cache. Overview and Health both fetch the same 180-day
// window (FIXED_DAYS === Overview's 180), so switching between the two tabs
// re-issued an identical health_metrics query milliseconds apart. Caching the
// in-flight promise coalesces those into one round trip and lets a rapid tab
// switch reuse the result. The TTL is deliberately short: both pages refetch on
// tab re-activation to pick up the nightly Health Sync, so anything past the
// window still gets fresh data — the cache only absorbs near-simultaneous and
// rapid-toggle reads, never a real return-to-tab. In-app there are no
// health_metrics writes (Health Sync is the only writer), so no manual
// invalidation is needed; the TTL self-heals. Keyed by `days` since different
// windows (30/35/90/180) are genuinely different reads.
const CACHE_TTL_MS = 30_000;
const healthCache = new Map<number, { ts: number; promise: Promise<HealthData> }>();

export function fetchHealthData(days = 180): Promise<HealthData> {
  const hit = healthCache.get(days);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.promise;

  const entry = { ts: Date.now(), promise: loadHealthData(days) };
  // Don't let a failed fetch stick for the whole TTL — evict on rejection so the
  // next caller retries. The original caller still sees the rejection.
  entry.promise.catch(() => {
    if (healthCache.get(days) === entry) healthCache.delete(days);
  });
  healthCache.set(days, entry);
  return entry.promise;
}
