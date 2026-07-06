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

import { rollingAvg } from "@features/health/math";
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

/** kg/month of lean-mass loss before "hold off on further cuts" is even
 *  considered. This is the scariest directive (it tells the user to stop the
 *  whole cut), so the bar is dull, not sensitive. */
const LEAN_MASS_FALL_KG_PER_MONTH = -0.5;
/** Trailing window for the lean-mass trend. 60 days (not 30) because scale body
 *  fat is the noisiest input: a longer window roughly halves the slope's standard
 *  error, making the significance gate meaningful at a sane loss rate. Calibrated
 *  against real exported data — with ±1.9% body-fat scatter, a 30-day fit had a
 *  slope std error of ±1.07 kg/month, so the old fixed −0.15 threshold sat ~14×
 *  inside the noise and effectively fired at random. */
const LEAN_MASS_WINDOW_DAYS = 60;
/** Minimum readings before the noise estimate itself is trustworthy. */
const LEAN_MASS_MIN_POINTS = 8;
/** The downslope must clear this many of its OWN standard errors before it counts
 *  as real rather than scatter. An SE-relative gate auto-adapts to each user's
 *  body-fat noise instead of a fixed point count (which rubber-stamps a noisy
 *  slope as "high confidence"). */
const LEAN_MASS_SIGNIF_K = 1.5;

export type LeanMassTrend = "stable" | "falling";

export interface LeanMassEvaluation {
  trend: LeanMassTrend;
  /** Fitted lean-mass slope over the trailing window, kg/month; null when there
   *  aren't enough readings to fit a trend. */
  slopePerMonth: number | null;
  confidence: "low" | "high";
}

/** Least-squares fit over the trailing `days`-day window: per-day slope plus its
 *  standard error, so the caller can tell a real trend from scale noise. Null
 *  when the window is too sparse or degenerate. */
function leanMassFit(
  pts: { date: string; value: number }[],
  days: number,
): { slopePerDay: number; seSlopePerDay: number } | null {
  const last = pts.at(-1)?.date;
  if (!last) return null;
  const cutoff = new Date(last + "T12:00:00");
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const win = pts.filter((p) => p.date >= cutoffStr);
  if (win.length < LEAN_MASS_MIN_POINTS) return null;
  const MS = 86400000;
  const t0 = new Date(win[0].date + "T12:00:00").getTime();
  const xs = win.map((p) => (new Date(p.date + "T12:00:00").getTime() - t0) / MS);
  const ys = win.map((p) => p.value);
  const n = win.length;
  const meanX = xs.reduce((a, x) => a + x, 0) / n;
  const meanY = ys.reduce((a, y) => a + y, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - meanX) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0);
  const slopePerDay = sxy / sxx;
  const intercept = meanY - slopePerDay * meanX;
  const sse = ys.reduce((a, y, i) => a + (y - (intercept + slopePerDay * xs[i])) ** 2, 0);
  const seSlopePerDay = Math.sqrt(sse / (n - 2) / sxx);
  return { slopePerDay, seSlopePerDay };
}

/** Lean mass = weight × (1 − bodyfat). Its trend is the "am I losing muscle?"
 *  judgment the Decision Engine reads. "falling" requires the downslope to be
 *  BOTH materially negative (≤ LEAN_MASS_FALL_KG_PER_MONTH) AND clearly above the
 *  noise of scale-derived lean mass (≥ K standard errors below flat). Otherwise
 *  it's a low-confidence "stable" — so a sparse or noisy window never fires the
 *  hold-cuts tier. */
export function buildLeanMassEvaluation(metrics: BodyMetric[]): LeanMassEvaluation {
  const lmPts = metrics
    .filter((m) => m.weight_kg != null && m.body_fat_pct != null)
    .map((m) => ({
      date: m.metric_date,
      value: (m.weight_kg as number) * (1 - (m.body_fat_pct as number) / 100),
    }));

  const fit = leanMassFit(lmPts, LEAN_MASS_WINDOW_DAYS);
  if (!fit) return { trend: "stable", slopePerMonth: null, confidence: "low" };

  const slopePerMonth = +(fit.slopePerDay * 30).toFixed(3);
  const sePerMonth = fit.seSlopePerDay * 30;
  const falling =
    slopePerMonth <= LEAN_MASS_FALL_KG_PER_MONTH &&
    slopePerMonth <= -LEAN_MASS_SIGNIF_K * sePerMonth;

  return { trend: falling ? "falling" : "stable", slopePerMonth, confidence: falling ? "high" : "low" };
}
