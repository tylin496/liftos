import { supabase } from "@shared/lib/supabase";
import type { Database } from "@shared/lib/database.types";
import { computeTdeeWindows, type TdeeEstimate } from "./tdee";
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
}

export async function fetchHealthData(days = 180): Promise<HealthData> {
  // Fetch extra history so previous-period TDEE windows are covered.
  const fetchDays = Math.max(days, 60);
  const allMetrics = await fetchBodyMetrics(fetchDays);

  const { tdee, tdeePrev } = computeTdeeWindows(allMetrics);

  const cutoffDisplay = sinceDate(days);
  const metrics = allMetrics.filter((m) => m.metric_date >= cutoffDisplay);

  return { metrics, tdee, tdeePrev };
}
