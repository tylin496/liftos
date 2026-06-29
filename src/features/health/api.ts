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

/** Everything the Health page needs: metrics + TDEE from avg active+resting energy. */
export async function fetchHealthData(days = 30): Promise<HealthData> {
  const metrics = await fetchBodyMetrics(days);
  const tdee = estimateTdee(
    metrics.map((m) => ({
      active: m.active_energy_kcal,
      resting: m.resting_energy_kcal,
    })),
  );
  return { metrics, tdee };
}
