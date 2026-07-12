import { supabase } from "@shared/lib/supabase";
import type { Database } from "@shared/lib/database.types";
import { computeTdeeWindows, type TdeeEstimate } from "./tdee";
import { computeActiveTarget, type ActiveTargetView } from "./activeTarget";
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
  return data ?? [];
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

export async function fetchHealthData(days = 180): Promise<HealthData> {
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
