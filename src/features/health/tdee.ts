export interface TdeeEstimate {
  tdee: number | null;
  avgActive: number | null;
  avgResting: number | null;
  dataPoints: number;
}

export function estimateTdee(
  metrics: { active: number | null; resting: number | null }[],
): TdeeEstimate {
  const valid = metrics.filter((m) => m.active != null && m.resting != null);
  if (!valid.length) {
    return { tdee: null, avgActive: null, avgResting: null, dataPoints: 0 };
  }

  const avgActive = Math.round(
    valid.reduce((s, m) => s + m.active!, 0) / valid.length,
  );
  const avgResting = Math.round(
    valid.reduce((s, m) => s + m.resting!, 0) / valid.length,
  );

  return {
    tdee: avgActive + avgResting,
    avgActive,
    avgResting,
    dataPoints: valid.length,
  };
}
