import { localDateStr, localDateStrDaysAgo } from "@shared/lib/date";

export interface TdeeEstimate {
  tdee: number | null;
  avgActive: number | null;
  avgResting: number | null;
  /** Number of days with resting energy data (30-day window). */
  restingDays: number;
  /** Number of days with active energy data (14-day window). */
  activeDays: number;
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
  };
}

/** Minimal metric shape needed to compute TDEE windows. */
export interface TdeeMetricRow {
  metric_date: string;
  resting_energy_kcal: number | null;
  active_energy_kcal: number | null;
}

/**
 * Current + previous-period TDEE from a list of body metrics (any order).
 *
 * Windows are TRAILING CALENDAR DAYS, not a reading count: resting = last 30
 * days, active = last 14. This must stay time-bounded — the cut math reads TDEE
 * as the *recent* metabolic rate, and resting drifts down over a cut, so a
 * count-based window that reached back over gaps would pull in older, higher
 * pre-cut readings and bias TDEE high (deficit under-counted). A missing day
 * just means the window averages fewer readings, never older ones. The previous
 * period shifts both back (resting 30–60d, active 14–28d) for an apples-to-
 * apples trend arrow. Single source of truth for TDEE windowing — Health card +
 * Overview both call it. Caller must supply ≥60 days for tdeePrev to be full.
 */
export function computeTdeeWindows(metrics: TdeeMetricRow[]): {
  tdee: TdeeEstimate;
  tdeePrev: TdeeEstimate;
} {
  const cutoff14 = localDateStrDaysAgo(14);
  const cutoff28 = localDateStrDaysAgo(28);
  const cutoff30 = localDateStrDaysAgo(30);
  const cutoff60 = localDateStrDaysAgo(60);
  // Exclude today from the current window: its live-sync row is a partial
  // reading (active energy accrues through the day) that would deflate the
  // average all morning. The sibling day-type baselines (math.ts) and the
  // active-target math exclude today for the same reason. This also squares the
  // windows — current active (>= cutoff14 && < today) spans 14 days, matching
  // the previous window's 14. The prev windows already end before today.
  const todayISO = localDateStr();

  const tdee = estimateTdee(
    metrics
      .filter((m) => m.metric_date >= cutoff30 && m.metric_date < todayISO)
      .map((m) => ({ resting: m.resting_energy_kcal })),
    metrics
      .filter((m) => m.metric_date >= cutoff14 && m.metric_date < todayISO)
      .map((m) => ({ active: m.active_energy_kcal })),
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
