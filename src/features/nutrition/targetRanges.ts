// Acceptable weekly weight-RATE band per phase, keyed on `phaseFromDeficit`
// output (see logic.ts). Values are positive magnitudes in kg/week, IN THE
// PHASE DIRECTION: loss for the cut modes, gain for Lean Bulk. Judgment sites
// compare `phaseDirection(kind) * observedRate` against the band (see
// evaluate()), so the map never needs signed values.
//
// Lean Bulk band rationale (~90 kg experienced lifter): lean-bulk convention is
// ~0.5–1.3% BW/month for intermediate/advanced ≈ 0.10–0.28 kg/week at 90 kg.
// min 0.10 sits exactly at the engine's STALLED_EPS so "stalled" and "below
// band" tile with no dead zone; max 0.30 caps worst-case fat accrual at about
// +1 pp body fat/month even if the entire overage were fat.
//
// Maintenance and Cruise have no band — a config in those modes is treated as
// "no tracked weight-rate target" (neutral, low-confidence) rather than judged
// against an invented range. Add entries here when those modes gain real targets.
export const PHASE_TARGET_RANGES: Record<string, { min: number; max: number }> = {
  "Moderate Cut": { min: 0.4, max: 0.7 },
  "Aggressive Cut": { min: 0.6, max: 0.9 },
  "Lean Bulk": { min: 0.1, max: 0.3 },
};
