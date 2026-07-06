// Round-weight milestones for compound lifts — the 🎯 tier of log-time feedback.
//
// A milestone fires when a new heaviest completed weight crosses a round "rung"
// the lift had never reached. Rungs tighten with load (every kg is harder up
// top): every 10kg under 100, every 5kg at 100 and above (…90, 100, 105, 110…).
//
// Compound-only — machine isolations load heavy (Leg Curl 102kg, Pec Deck 87.5)
// and would spam rungs, and there's no reliable heuristic, so it's an explicit
// per-exercise flag (exercises.compound). The caller gates on that flag; this
// module is pure weight math.

const FINE_FROM_KG = 100; // at/above this, rungs step by FINE_STEP
const COARSE_STEP = 10; // rung spacing below FINE_FROM_KG
const FINE_STEP = 5; // rung spacing at/above FINE_FROM_KG

/** The highest milestone rung at or below `weightKg` (0 below the first rung). */
export function milestoneAtOrBelow(weightKg: number): number {
  if (weightKg < COARSE_STEP) return 0;
  const step = weightKg < FINE_FROM_KG ? COARSE_STEP : FINE_STEP;
  return Math.floor(weightKg / step) * step;
}

/** The milestone newly reached by completing `newWeightKg`, given the heaviest
 *  weight ever completed before it (`prevBestKg`) — or null if no new rung was
 *  crossed. Only a genuinely heavier top set can cross a rung, so a non-null
 *  result also implies a weight-axis PR. Returns the HIGHEST rung crossed (one
 *  toast, not one per rung jumped). Compound-gating is the caller's job. */
export function milestoneReached(newWeightKg: number, prevBestKg: number): number | null {
  const reached = milestoneAtOrBelow(newWeightKg);
  return reached > milestoneAtOrBelow(prevBestKg) ? reached : null;
}
