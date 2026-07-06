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
  /** Largest interior gap (days) between readings in the window — caps the data
   *  half of the confidence score, so it's exposed here for debugging. */
  longestGap: number;
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

/** Canonical weekly weight rate (kg/week) — the exact number the UI's "Trend"
 *  shows: a least-squares slope over the same trailing 21-day window `evaluate`
 *  uses for `observedRate`. Any surface that reports a weekly rate (Overview
 *  card, AI export) must call this so they can never disagree. Returns null
 *  (not a fabricated 0) when the window has too few readings to fit a trend. */
export function weeklyWeightRate(weightSeries: { date: string; value: number }[]): {
  ratePerWeekKg: number | null;
  windowDays: number;
  dataPoints: number;
} {
  const slope = regressionSlope(weightSeries, WINDOW_DAYS);
  return {
    ratePerWeekKg: slope == null ? null : +slope.toFixed(3),
    windowDays: WINDOW_DAYS,
    dataPoints: windowPoints(weightSeries, WINDOW_DAYS).length,
  };
}

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

/** Largest interior gap (in days) between consecutive readings in the window.
 *  With at most one reading per day, point count already implies a minimum span
 *  (N points ⇒ ≥ N−1 days), so density alone can't tell a trend fitted across a
 *  hole from an honestly dense one. A big gap turns the regression into a long
 *  lever arm — two clusters joined by a void — that's over-sensitive to the
 *  points at each end. Returns 0 for <2 points (moot: <5 points fits no trend at
 *  all → the evaluation is already forced to low confidence). */
function longestGap(pts: { date: string; value: number }[], days: number): number {
  const win = windowPoints(pts, days);
  if (win.length < 2) return 0;
  const MS = 86400000;
  let max = 0;
  for (let i = 1; i < win.length; i++) {
    const prev = new Date(win[i - 1].date + "T12:00:00").getTime();
    const cur = new Date(win[i].date + "T12:00:00").getTime();
    const gap = Math.round((cur - prev) / MS);
    if (gap > max) max = gap;
  }
  return max;
}

/** Confidence combines three signals (each 0–2): how long the user has held the
 *  current target, how much *well-distributed* weight data backs the trend, and
 *  how clean the trend is. Sum 0–6 → low / medium / high. */
function computeConfidence(
  daysOnTarget: number,
  weightDataPoints: number,
  gapDays: number,
  scatter: number,
): Confidence {
  // Data signal answers "enough data AND spread across the window?": the point
  // count, capped by the largest hole. A dense window straddling a two-week gap
  // is a two-cluster lever-arm fit, not that many honest days — so a ≤3-day gap
  // passes, a week-plus hole drops the whole signal to 0. Because logging is
  // one-per-day, count already implies span, so a hole (not clustering) is the
  // only distribution failure left to catch — and only min() catches it.
  const gapBucket = gapDays <= 3 ? 2 : gapDays <= 6 ? 1 : 0;
  const dataScore = Math.min(bucket3(weightDataPoints, 14, 8), gapBucket);
  const score =
    bucket3(daysOnTarget, 14, 7) +
    dataScore +
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
  const gapDays = longestGap(weightSeries, WINDOW_DAYS);

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
    longestGap: gapDays,
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
    gapDays,
    trendScatter(weightSeries, WINDOW_DAYS, slope),
  );

  return {
    evaluation: { status, observedRate, targetRange: range, confidence, evaluatedAt },
    diagnostics,
  };
}

