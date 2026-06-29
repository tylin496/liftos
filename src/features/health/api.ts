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
}

/**
 * Fetch health data for display plus a TDEE estimate.
 *
 * TDEE uses split windows regardless of the display range:
 *   - Resting energy: 30-day average (changes slowly)
 *   - Active energy: 14-day average (fluctuates more)
 *
 * The returned `metrics` are filtered to the requested `days` for display.
 */
export async function fetchHealthData(days = 30): Promise<HealthData> {
  // Always fetch at least 30 days so TDEE resting window is fully covered.
  const fetchDays = Math.max(days, 30);
  const allMetrics = await fetchBodyMetrics(fetchDays);

  const cutoff14 = sinceDate(14);
  const tdee = estimateTdee(
    allMetrics.map((m) => ({ resting: m.resting_energy_kcal })),
    allMetrics
      .filter((m) => m.metric_date >= cutoff14)
      .map((m) => ({ active: m.active_energy_kcal })),
  );

  // Trim to the requested display window.
  const cutoffDisplay = sinceDate(days);
  const metrics = allMetrics.filter((m) => m.metric_date >= cutoffDisplay);

  return { metrics, tdee };
}
