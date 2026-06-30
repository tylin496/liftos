export interface TdeeEstimate {
  tdee: number | null;
  avgActive: number | null;
  avgResting: number | null;
  /** Number of days with resting energy data (30-day window). */
  restingDays: number;
  /** Number of days with active energy data (14-day window). */
  activeDays: number;
  /** @deprecated Use restingDays. Kept for backward compatibility. */
  dataPoints: number;
}

/**
 * Estimate TDEE using split averaging windows:
 * - Resting energy: averaged over a longer window (typically 30 days) — changes slowly.
 * - Active energy: averaged over a shorter window (typically 14 days) — fluctuates more.
 */
export function estimateTdee(
  restingMetrics: { resting: number | null }[],
  activeMetrics: { active: number | null }[],
): TdeeEstimate {
  const validResting = restingMetrics.filter((m) => m.resting != null);
  const validActive = activeMetrics.filter((m) => m.active != null);

  if (!validResting.length || !validActive.length) {
    return {
      tdee: null,
      avgActive: null,
      avgResting: null,
      restingDays: validResting.length,
      activeDays: validActive.length,
      dataPoints: validResting.length,
    };
  }

  const avgResting = Math.round(
    validResting.reduce((s, m) => s + m.resting!, 0) / validResting.length,
  );
  const avgActive = Math.round(
    validActive.reduce((s, m) => s + m.active!, 0) / validActive.length,
  );

  return {
    tdee: avgActive + avgResting,
    avgActive,
    avgResting,
    restingDays: validResting.length,
    activeDays: validActive.length,
    dataPoints: validResting.length,
  };
}

/** Minimal metric shape needed to compute TDEE windows. */
export interface TdeeMetricRow {
  metric_date: string;
  resting_energy_kcal: number | null;
  active_energy_kcal: number | null;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Current + previous-period TDEE from a list of body metrics (any order).
 * Resting window = 30 days, active window = 14 days. The previous period shifts
 * both back (resting 30–60d ago, active 14–28d ago) for an apples-to-apples
 * trend arrow. This is the single source of truth for TDEE windowing — both the
 * Health card and the Overview summary call it so the two never diverge.
 * Caller must supply ≥60 days of metrics for tdeePrev to be meaningful.
 */
export function computeTdeeWindows(metrics: TdeeMetricRow[]): {
  tdee: TdeeEstimate;
  tdeePrev: TdeeEstimate;
} {
  const cutoff14 = daysAgoISO(14);
  const cutoff28 = daysAgoISO(28);
  const cutoff30 = daysAgoISO(30);
  const cutoff60 = daysAgoISO(60);

  const tdee = estimateTdee(
    metrics.filter((m) => m.metric_date >= cutoff30).map((m) => ({ resting: m.resting_energy_kcal })),
    metrics.filter((m) => m.metric_date >= cutoff14).map((m) => ({ active: m.active_energy_kcal })),
  );

  const tdeePrev = estimateTdee(
    metrics
      .filter((m) => m.metric_date >= cutoff60 && m.metric_date < cutoff30)
      .map((m) => ({ resting: m.resting_energy_kcal })),
    metrics
      .filter((m) => m.metric_date >= cutoff28 && m.metric_date < cutoff14)
      .map((m) => ({ active: m.active_energy_kcal })),
  );

  return { tdee, tdeePrev };
}
