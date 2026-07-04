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

/** Resting changes slowly → average more readings; active fluctuates → fewer. */
const RESTING_READINGS = 30;
const ACTIVE_READINGS = 14;

/**
 * Current + previous-period TDEE from a list of body metrics (any order).
 *
 * Windows are counted by READINGS, not calendar days: the current resting
 * average is the most recent 30 days that actually have a resting value, active
 * the most recent 14. Reaching past gaps this way means a missed sync (or a
 * not-yet-synced today) doesn't shrink the sample to "29 of 30" — the average
 * always uses a full window once enough history exists, so the "30-day average"
 * label stays put instead of ticking down on a single missing day. The previous
 * period is the block of readings immediately before the current one, for an
 * apples-to-apples trend arrow. Trade-off: a gappy stretch spans slightly more
 * calendar days — fine for these slow / among-noise averages. Single source of
 * truth for TDEE windowing — Health card + Overview both call it.
 */
export function computeTdeeWindows(metrics: TdeeMetricRow[]): {
  tdee: TdeeEstimate;
  tdeePrev: TdeeEstimate;
} {
  const sorted = [...metrics].sort((a, b) => a.metric_date.localeCompare(b.metric_date));
  const resting = sorted
    .filter((m) => m.resting_energy_kcal != null)
    .map((m) => ({ resting: m.resting_energy_kcal }));
  const active = sorted
    .filter((m) => m.active_energy_kcal != null)
    .map((m) => ({ active: m.active_energy_kcal }));

  const tdee = estimateTdee(
    resting.slice(-RESTING_READINGS),
    active.slice(-ACTIVE_READINGS),
  );
  const tdeePrev = estimateTdee(
    resting.slice(-2 * RESTING_READINGS, -RESTING_READINGS),
    active.slice(-2 * ACTIVE_READINGS, -ACTIVE_READINGS),
  );

  return { tdee, tdeePrev };
}
