import { supabase } from "@shared/lib/supabase";
import type { Database } from "@shared/lib/database.types";
import { estimateTdee, type TdeeEstimate } from "./tdee";

export type BodyMetric = Database["public"]["Tables"]["body_metrics"]["Row"];

function sinceDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Last N days of Apple Health metrics, oldest → newest. RLS-scoped. */
export async function fetchBodyMetrics(days = 90): Promise<BodyMetric[]> {
  const { data, error } = await supabase
    .from("body_metrics")
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

  const cutoff30 = sinceDate(30);
  const cutoff14 = sinceDate(14);
  const cutoff60 = sinceDate(60);
  const cutoff28 = sinceDate(28);

  const tdee = estimateTdee(
    allMetrics
      .filter((m) => m.metric_date >= cutoff30)
      .map((m) => ({ resting: m.resting_energy_kcal })),
    allMetrics
      .filter((m) => m.metric_date >= cutoff14)
      .map((m) => ({ active: m.active_energy_kcal })),
  );

  // Previous period: resting 30–60 days ago, active 14–28 days ago
  const tdeePrev = estimateTdee(
    allMetrics
      .filter((m) => m.metric_date >= cutoff60 && m.metric_date < cutoff30)
      .map((m) => ({ resting: m.resting_energy_kcal })),
    allMetrics
      .filter((m) => m.metric_date >= cutoff28 && m.metric_date < cutoff14)
      .map((m) => ({ active: m.active_energy_kcal })),
  );

  const cutoffDisplay = sinceDate(days);
  const metrics = allMetrics.filter((m) => m.metric_date >= cutoffDisplay);

  return { metrics, tdee, tdeePrev };
}
