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
