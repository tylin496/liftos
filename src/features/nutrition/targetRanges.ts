// Acceptable weekly weight-loss band per cut mode, keyed on `phaseFromDeficit`
// output (see logic.ts). Values are positive loss magnitudes in kg/week.
//
// Only the two cut modes the app actually runs are defined. Maintenance and
// Cruise have no band yet — a config in those modes is treated as "not enough
// of a cut to evaluate" (neutral, low-confidence) rather than judged against an
// invented range. Add entries here when those modes gain real targets.
export const CUT_MODE_TARGET_RANGES: Record<string, { min: number; max: number }> = {
  "Moderate Cut": { min: 0.4, max: 0.7 },
  "Aggressive Cut": { min: 0.6, max: 0.9 },
};
