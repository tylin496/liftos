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
export async function fetchBodyMetrics(days = 90): Promise<BodyMetric[]> {
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

/** Persist the user's maintenance TDEE goal. */
export async function saveTargetTdee(targetTdee: number | null): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error("Not signed in");
  const { error } = await supabase
    .from("nutrition_config")
    .update({ target_tdee: targetTdee })
    .eq("user_id", userData.user.id);
  if (error) throw error;
}

export async function fetchHealthData(days = 180): Promise<HealthData> {
  // Fetch extra history so previous-period TDEE windows are covered.
  const fetchDays = Math.max(days, 60);
  const [allMetrics, targetTdee] = await Promise.all([
    fetchBodyMetrics(fetchDays),
    fetchTargetTdee(),
  ]);

  const { tdee, tdeePrev } = computeTdeeWindows(allMetrics);
  const activeTarget = computeActiveTarget(allMetrics, targetTdee, tdee.avgResting);

  const cutoffDisplay = sinceDate(days);
  const metrics = allMetrics.filter((m) => m.metric_date >= cutoffDisplay);

  return { metrics, tdee, tdeePrev, targetTdee, activeTarget };
}
