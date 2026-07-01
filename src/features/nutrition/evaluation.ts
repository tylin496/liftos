// Nutrition Evaluation (v2) — the Evaluation + Diagnostics layer.
//
// This is the "is the cut working?" brain: it joins the observed bodyweight
// trend (Health) with the current calorie target to decide whether weight loss
// is tracking the plan. Pure and deterministic — no Supabase, no React — so it
// is trivial to test and is the single place this judgment is made.
//
// Layering (see the v2 spec):
//   - NutritionEvaluation  → describes reality only (the judgment).
//   - NutritionDiagnostics → explains *why* (estimated intake/TDEE). Descriptive
//                            only; it never feeds back into the judgment.

import { regressionSlope } from "@features/health/math";
import { CUT_MODE_TARGET_RANGES } from "./targetRanges";

export type EvalStatus = "below_target" | "on_target" | "above_target";
export type Confidence = "low" | "medium" | "high";

export interface NutritionEvaluation {
  status: EvalStatus;
  /** Observed weekly weight change, kg/week. Negative = losing. */
  observedRate: number;
  /** Acceptable loss band for the current cut mode (positive kg/week). */
  targetRange: { min: number; max: number };
  confidence: Confidence;
  /** ISO timestamp of when this evaluation was produced. */
  evaluatedAt: string;
}

export interface NutritionDiagnostics {
  estimatedTdee: number;
  /** TDEE + observed energy balance implied by the weight trend, kcal/day. */
  estimatedIntake: number;
  /** estimatedIntake − calorieTarget. Descriptive; never triggers a change. */
  intakeDifference: number;
  calorieTarget: number;
  cutMode: string;
  windowDays: number;
  weightDataPoints: number;
  /** Trailing consecutive days logged at the current target (0 = just changed). */
  daysOnTarget: number;
}

export interface NutritionState {
  evaluation: NutritionEvaluation;
  diagnostics: NutritionDiagnostics;
}

export interface EvaluateInput {
  /** Bodyweight series, ascending by date: { date: "YYYY-MM-DD", value: kg }. */
  weightSeries: { date: string; value: number }[];
  /** Cut mode name from `phaseFromDeficit` (e.g. "Moderate Cut"). */
  cutMode: string;
  calorieTarget: number;
  estimatedTdee: number;
  /** Trailing consecutive days logged at the current calorie target. */
  daysOnTarget: number;
  /** Injected for determinism/testability. */
  now: Date;
}

const KCAL_PER_KG = 7700;
const WINDOW_DAYS = 21;
/** Minimum weight readings in the window before a trend can be fit (mirrors
 *  regressionSlope's own guard). Below this, `evaluate` falls back to
 *  observedRate = 0 — a placeholder, not a measurement — so surfaces should
 *  render the rate as "—" rather than a fabricated "0.00 kg/wk". */
export const MIN_TREND_POINTS = 5;
/** kg/week deadband around the range edges so the status doesn't flap. */
const STATUS_EPS = 0.02;
/** Below this many trailing days on the current target, the 21-day trend still
 *  carries weight from the prior target, so a capped confidence is worth
 *  explaining. Mirrors the "strong" edge of the daysOnTarget confidence bucket. */
export const FRESH_TARGET_DAYS = 14;

/** Points falling inside the trailing `days` window (mirrors regressionSlope). */
function windowPoints(pts: { date: string; value: number }[], days: number) {
  const last = pts.at(-1)?.date;
  if (!last) return [];
  const cutoff = new Date(last + "T12:00:00");
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return pts.filter((p) => p.date >= cutoffStr);
}

/** Mean absolute residual (kg) around the fitted trend line in the window —
 *  a low value means the trend is clean, so the observed rate is trustworthy. */
function trendScatter(
  pts: { date: string; value: number }[],
  days: number,
  slopePerWeek: number,
): number {
  const win = windowPoints(pts, days);
  if (win.length < 2) return Infinity;
  const MS = 86400000;
  const t0 = new Date(win[0].date + "T12:00:00").getTime();
  const xs = win.map((p) => (new Date(p.date + "T12:00:00").getTime() - t0) / MS);
  const ys = win.map((p) => p.value);
  const slopePerDay = slopePerWeek / 7;
  const meanX = xs.reduce((s, x) => s + x, 0) / xs.length;
  const meanY = ys.reduce((s, y) => s + y, 0) / ys.length;
  const intercept = meanY - slopePerDay * meanX;
  const resid = ys.map((y, i) => Math.abs(y - (intercept + slopePerDay * xs[i])));
  return resid.reduce((s, r) => s + r, 0) / resid.length;
}

function bucket3(value: number, strong: number, medium: number): 0 | 1 | 2 {
  if (value >= strong) return 2;
  if (value >= medium) return 1;
  return 0;
}

/** Confidence combines three signals (each 0–2): how long the user has held
 *  the current target, how much weight data backs the trend, and how clean the
 *  trend is. Sum 0–6 → low / medium / high. */
function computeConfidence(daysOnTarget: number, weightDataPoints: number, scatter: number): Confidence {
  const score =
    bucket3(daysOnTarget, 14, 7) +
    bucket3(weightDataPoints, 14, 8) +
    // Lower scatter is better, so invert: <0.4 kg → 2, <0.8 kg → 1, else 0.
    (scatter < 0.4 ? 2 : scatter < 0.8 ? 1 : 0);
  return score >= 5 ? "high" : score >= 3 ? "medium" : "low";
}

export function evaluate(input: EvaluateInput): NutritionState {
  const { weightSeries, cutMode, calorieTarget, estimatedTdee, daysOnTarget, now } = input;
  const evaluatedAt = now.toISOString();
  const range = CUT_MODE_TARGET_RANGES[cutMode] ?? null;

  const slope = regressionSlope(weightSeries, WINDOW_DAYS); // kg/week or null
  const observedRate = slope ?? 0;
  const weightDataPoints = windowPoints(weightSeries, WINDOW_DAYS).length;

  // Diagnostics: what intake the weight trend implies, vs the target. The energy
  // balance from the trend (observedRate kg/wk × 7700 kcal/kg ÷ 7 days) added to
  // TDEE gives the estimated actual daily intake.
  const estimatedIntake = Math.round(estimatedTdee + (observedRate * KCAL_PER_KG) / 7);
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: Math.round(estimatedTdee),
    estimatedIntake,
    intakeDifference: Math.round(estimatedIntake - calorieTarget),
    calorieTarget: Math.round(calorieTarget),
    cutMode,
    windowDays: WINDOW_DAYS,
    weightDataPoints,
    daysOnTarget,
  };

  // No band for this cut mode, or not enough weight data to fit a trend → we
  // can't judge. Return a neutral, low-confidence evaluation.
  if (!range || slope == null) {
    return {
      evaluation: {
        status: "on_target",
        observedRate,
        targetRange: range ?? { min: 0, max: 0 },
        confidence: "low",
        evaluatedAt,
      },
      diagnostics,
    };
  }

  // Judge the loss magnitude against the band. observedRate is negative while
  // losing, so loss = −observedRate. Below the band = losing too slowly.
  const loss = -observedRate;
  const status: EvalStatus =
    loss < range.min - STATUS_EPS ? "below_target"
    : loss > range.max + STATUS_EPS ? "above_target"
    : "on_target";

  const confidence = computeConfidence(
    daysOnTarget,
    weightDataPoints,
    trendScatter(weightSeries, WINDOW_DAYS, slope),
  );

  return {
    evaluation: { status, observedRate, targetRange: range, confidence, evaluatedAt },
    diagnostics,
  };
}

/** On-demand explanation for a capped confidence, shown when the user taps the
 *  Confidence value. Returns null when there's nothing worth saying — either the
 *  trend can't be fit (the rate already renders as "—"), confidence is already
 *  high, or the target has been held long enough that its tenure no longer limits
 *  the read. The one case it surfaces: a *fresh* target, where the 21-day trend
 *  still partly reflects the prior target, so the observed rate isn't yet a clean
 *  verdict on the current one. */
export function confidenceReason(
  evaluation: Pick<NutritionEvaluation, "confidence">,
  diagnostics: Pick<NutritionDiagnostics, "daysOnTarget" | "weightDataPoints">,
): string | null {
  const { confidence } = evaluation;
  const { daysOnTarget, weightDataPoints } = diagnostics;
  if (weightDataPoints < MIN_TREND_POINTS) return null; // no trend → rate is "—"
  if (confidence === "high") return null; // tenure isn't the limiter
  if (daysOnTarget >= FRESH_TARGET_DAYS) return null; // target well-established
  const label = confidence === "low" ? "Low" : "Medium";
  const span =
    daysOnTarget <= 0 ? "only became active today"
    : daysOnTarget === 1 ? "has only been active for 1 day"
    : `has only been active for ${daysOnTarget} days`;
  return `${label} because this target ${span}.`;
}
