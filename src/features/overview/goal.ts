// Primary Goal — the upstream Provider.
//
// This is the ONLY place goal numbers are computed. The Overview card is pure
// render: it receives a finished `Goal` payload and draws it. Swapping the goal
// type later (lean bulk / maintenance / recomp) means writing a new branch here
// and never touching the card.
//
// The evaluation deliberately smooths its inputs — a 30-day lean-mass average
// and a 14-day body-fat average — instead of using the day's raw readings, so
// Apple Health noise can't make progress appear to slide backwards.

import { rollingAvg, regressionSlope } from "@features/health/math";
import type { BodyMetric } from "@features/health/api";

export type GoalType = "fat_loss" | "lean_bulk" | "maintenance" | "recomp";

export interface GoalEvaluation {
  /** 0–100, how far along the fat-loss journey the smoothed body fat has come. */
  progressPct: number;
  /** Latest raw weight — the "where you are today" display value. */
  currentWeight: number;
  /** leanMass30dAvg / (1 − targetBodyFat/100). */
  goalWeight: number;
  /** currentWeight − goalWeight; positive = still to lose. */
  remainingWeight: number;
  /** Latest raw body-fat % — display value. */
  currentBodyFat: number;
  /** Target body-fat %, from config. */
  targetBodyFat: number;
  /** 30-day average lean mass (kg) — drives goalWeight. */
  leanMass30dAvg: number;
  /** 14-day average body fat (%) — drives progressPct. */
  bodyFat14dAvg: number;
}

export interface Goal {
  type: GoalType;
  targetBodyFat: number;
  evaluation: GoalEvaluation;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Average of the readings in the `days`-day window starting on `startDate`
 *  (inclusive). Used ONCE at Save time to turn a chosen cut-start date into a
 *  smoothed snapshot; the result is persisted and never recomputed on read.
 *  Returns null when the window holds no readings. */
function windowAvgFrom(pts: { date: string; value: number }[], startDate: string, days: number): number | null {
  const end = new Date(startDate + "T12:00:00");
  end.setDate(end.getDate() + days - 1);
  const endStr = end.toISOString().slice(0, 10);
  const window = pts.filter((p) => p.date >= startDate && p.date <= endStr);
  if (!window.length) return null;
  return window.reduce((s, p) => s + p.value, 0) / window.length;
}

/** Smoothed body composition on the day a cut began — the 14-day body-fat and
 *  weight averages starting at `startDate`. Called once, by the one-time baseline
 *  initializer, to snapshot an immutable starting line into config (progress then
 *  reads that persisted value, not this). Returns nulls when the window holds no
 *  readings (e.g. the date predates the fetched metrics). */
export function cutBaselineAt(
  metrics: BodyMetric[],
  startDate: string,
): { bodyFatPct: number | null; weightKg: number | null } {
  const bfPts = metrics
    .filter((m) => m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: m.body_fat_pct as number }));
  const wtPts = metrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, value: m.weight_kg as number }));
  return {
    bodyFatPct: windowAvgFrom(bfPts, startDate, 14),
    weightKg: windowAvgFrom(wtPts, startDate, 14),
  };
}

/** Build the fat-loss Goal payload, or null when there isn't enough body-
 *  composition data (no target, or no weight+bodyfat readings) to evaluate. */
export function computeGoal(
  metrics: BodyMetric[],
  targetBodyFat: number | null,
  cutStartBodyFat: number | null = null,
): Goal | null {
  if (targetBodyFat == null) return null;

  const bfPts = metrics
    .filter((m) => m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: m.body_fat_pct as number }));
  const lmPts = metrics
    .filter((m) => m.weight_kg != null && m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: (m.weight_kg as number) * (1 - (m.body_fat_pct as number) / 100) }));
  const wtPts = metrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, value: m.weight_kg as number }));

  const leanMass30dAvg = rollingAvg(lmPts, 30, 0);
  const bodyFat14dAvg = rollingAvg(bfPts, 14, 0);
  const currentWeight = wtPts.at(-1)?.value ?? null;
  const currentBodyFat = bfPts.at(-1)?.value ?? null;

  if (leanMass30dAvg == null || bodyFat14dAvg == null || currentWeight == null || currentBodyFat == null) {
    return null;
  }

  const goalWeight = leanMass30dAvg / (1 - targetBodyFat / 100);
  const remainingWeight = currentWeight - goalWeight;

  // Progress = fraction of the body-fat gap closed since the starting point.
  // The start line is the fixed cut baseline persisted in config (`cutStartBodyFat`)
  // — a value set once and never drifting. If it isn't set, fall back to the
  // current 14-day average, which reads as 0% progress. Already-at-or-below-target
  // reads as 100%.
  const startBodyFat = cutStartBodyFat ?? bodyFat14dAvg;
  const span = startBodyFat - targetBodyFat;
  const progressPct = span > 0 ? clamp(((startBodyFat - bodyFat14dAvg) / span) * 100, 0, 100) : 100;

  return {
    type: "fat_loss",
    targetBodyFat,
    evaluation: {
      progressPct,
      currentWeight,
      goalWeight,
      remainingWeight,
      currentBodyFat,
      targetBodyFat,
      leanMass30dAvg,
      bodyFat14dAvg,
    },
  };
}

// ─── Lean Mass Evaluation (the Decision Engine's body-composition slice) ─────

/** kg/month of lean-mass loss before "hold off on further cuts" is warranted.
 *  Deliberately dull, not sensitive: this is the scariest directive (it tells
 *  the user to stop the whole cut), so it must never fire on scale-body-fat
 *  noise. Only a sustained, well-populated 30-day downslope trips it. */
const LEAN_MASS_FALL_KG_PER_MONTH = -0.15;
/** Readings needed inside the 30-day window before the lean-mass slope is
 *  trustworthy. Lean mass rides on body-fat %, the noisiest input, so a sparse
 *  window can't support a "stop cutting" call. */
const LEAN_MASS_MIN_POINTS = 10;

export type LeanMassTrend = "stable" | "falling";

export interface LeanMassEvaluation {
  trend: LeanMassTrend;
  /** Fitted lean-mass slope over the trailing 30 days, kg/month; null when the
   *  window has too few readings to fit a trend. */
  slopePerMonth: number | null;
  confidence: "low" | "high";
}

/** Count of readings falling inside the trailing `days`-day window. */
function countInWindow(pts: { date: string }[], days: number): number {
  const last = pts.at(-1)?.date;
  if (!last) return 0;
  const cutoff = new Date(last + "T12:00:00");
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return pts.filter((p) => p.date >= cutoffStr).length;
}

/** Lean mass = weight × (1 − bodyfat). Its 30-day trend is the "am I losing
 *  muscle?" judgment the Decision Engine reads. Returns a low-confidence "stable"
 *  whenever the data can't support a confident call, so absence never fires the
 *  hold-cuts tier. */
export function buildLeanMassEvaluation(metrics: BodyMetric[]): LeanMassEvaluation {
  const lmPts = metrics
    .filter((m) => m.weight_kg != null && m.body_fat_pct != null)
    .map((m) => ({
      date: m.metric_date,
      value: (m.weight_kg as number) * (1 - (m.body_fat_pct as number) / 100),
    }));

  const slopePerWeek = regressionSlope(lmPts, 30); // kg/week, or null (<5 points)
  if (slopePerWeek == null) return { trend: "stable", slopePerMonth: null, confidence: "low" };

  const slopePerMonth = +(slopePerWeek * (30 / 7)).toFixed(3);
  const confidence: LeanMassEvaluation["confidence"] =
    countInWindow(lmPts, 30) >= LEAN_MASS_MIN_POINTS ? "high" : "low";
  const trend: LeanMassTrend =
    confidence === "high" && slopePerMonth <= LEAN_MASS_FALL_KG_PER_MONTH ? "falling" : "stable";

  return { trend, slopePerMonth, confidence };
}
