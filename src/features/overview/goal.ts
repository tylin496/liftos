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
import { clamp } from "@shared/lib/num";
import { olsFit } from "@shared/lib/stats";

type GoalType = "fat_loss" | "lean_bulk" | "maintenance" | "recomp";

interface GoalEvaluation {
  /** 0–100, fraction of the weight gap (cut-start weight → goalWeight) closed
   *  by the smoothed current weight. Body fat is reference-only — see the
   *  progressPct comment in computeGoal for why it doesn't drive this. */
  progressPct: number;
  /** 7-day smoothed weight — drives progressPct/remainingWeight/"Down" so a
   *  single water-weight day can't jerk the bar. Not the raw daily reading. */
  currentWeight: number;
  /** Frozen at the cut's start: leanMassAtStart / (1 − targetBodyFat/100). */
  goalWeight: number;
  /** currentWeight − goalWeight; positive = still to lose. */
  remainingWeight: number;
  /** Latest raw body-fat % — reference display only, doesn't drive progress. */
  currentBodyFat: number;
  /** Target body-fat %, from config. */
  targetBodyFat: number;
  /** 30-day average lean mass (kg) — fallback for goalWeight, pre-baseline only. */
  leanMass30dAvg: number;
  /** 14-day average body fat (%) — reference display only. */
  bodyFat14dAvg: number;
}

export interface Goal {
  type: GoalType;
  targetBodyFat: number;
  evaluation: GoalEvaluation;
}

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
  cutStartWeight: number | null = null,
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
  const weight7dAvg = rollingAvg(wtPts, 7, 0);
  const currentBodyFat = bfPts.at(-1)?.value ?? null;

  if (leanMass30dAvg == null || bodyFat14dAvg == null || weight7dAvg == null || currentBodyFat == null) {
    return null;
  }

  // Goal weight is frozen at the cut's start — lean mass on day one, projected
  // onto the target body-fat % — not recomputed from the live lean-mass trend.
  // Falls back to the live 30-day average only pre-baseline (no cut_start_*
  // persisted yet); that path never actually renders, since CutBaselineCard
  // shows instead of this card until a baseline exists.
  const leanMassAtStart =
    cutStartWeight != null && cutStartBodyFat != null
      ? cutStartWeight * (1 - cutStartBodyFat / 100)
      : leanMass30dAvg;
  const goalWeight = leanMassAtStart / (1 - targetBodyFat / 100);
  const remainingWeight = weight7dAvg - goalWeight;

  // Progress = fraction of the WEIGHT gap closed since the starting point,
  // using a 7-day smoothed "today" weight so a single water-weight day can't
  // jerk the bar. Deliberately not body-fat-based: body fat is too noisy a
  // reading to anchor the headline % on, and a body-fat-based % has no
  // algebraic relationship to the Down/Remaining kg shown right next to it —
  // the two used to visibly disagree (e.g. 47% next to a 9.7/16.7 = 58% pair)
  // even though neither was "wrong." Body fat stays a reference sub-label only.
  const startWeight = cutStartWeight ?? weight7dAvg;
  const span = startWeight - goalWeight;
  const progressPct = span > 0 ? clamp(((startWeight - weight7dAvg) / span) * 100, 0, 100) : 100;

  return {
    type: "fat_loss",
    targetBodyFat,
    evaluation: {
      progressPct,
      currentWeight: weight7dAvg,
      goalWeight,
      remainingWeight,
      currentBodyFat,
      targetBodyFat,
      leanMass30dAvg,
      bodyFat14dAvg,
    },
  };
}

// ─── Bulk Goal (the Journey card's lean-bulk payload) ────────────────────────

export interface BulkGoalEvaluation {
  /** 7-day smoothed weight — same smoothing as the cut payload. */
  currentWeight: number;
  /** currentWeight − bulk_start_weight; positive = gained (the headline stat,
   *  up-good under the bulk's polarity). */
  gainedWeight: number;
  /** 0–100, how much of the body-fat budget (start → ceiling) the 14-day
   *  average has consumed. Rendered in NEUTRAL→WARN tones only — spending the
   *  budget is expected, not celebrated; a green/gold "progress toward the fat
   *  ceiling" would be exactly the wrong framing. */
  budgetUsedPct: number;
  /** 14-day average body fat (%) — the same number buildBulkGoalStatus judges. */
  bodyFat14dAvg: number;
  /** Latest raw body-fat % — reference display only. */
  currentBodyFat: number;
  /** Persisted baseline body fat (%) at the bulk's start. */
  startBodyFat: number;
  /** Configured endpoint ceiling (%). */
  bfCeiling: number;
  /** bfCeiling − bodyFat14dAvg, percentage points left before "Start the cut". */
  headroomPp: number;
}

export interface BulkGoal {
  type: "lean_bulk";
  bfCeiling: number;
  evaluation: BulkGoalEvaluation;
}

/** Build the lean-bulk Goal payload, or null when the bulk isn't configured
 *  (no ceiling / no persisted baseline — the initializer card renders instead)
 *  or there isn't enough body-composition data. Mirrors computeGoal's contract:
 *  computed entirely here, the card only draws it. */
export function computeBulkGoal(
  metrics: BodyMetric[],
  bfCeiling: number | null,
  bulkStartWeight: number | null,
  bulkStartBodyFat: number | null,
): BulkGoal | null {
  if (bfCeiling == null || bulkStartWeight == null || bulkStartBodyFat == null) return null;

  const bfPts = metrics
    .filter((m) => m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: m.body_fat_pct as number }));
  const wtPts = metrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.metric_date, value: m.weight_kg as number }));

  const bodyFat14dAvg = rollingAvg(bfPts, 14, 0);
  const weight7dAvg = rollingAvg(wtPts, 7, 0);
  const currentBodyFat = bfPts.at(-1)?.value ?? null;
  if (bodyFat14dAvg == null || weight7dAvg == null || currentBodyFat == null) return null;

  // Fat budget: how far bf14 has moved from the frozen start toward the
  // ceiling. The start is persisted (the destination can move, the starting
  // line shouldn't — same rule as the cut baseline); a degenerate span
  // (ceiling at/under the start) reads as fully spent rather than dividing
  // by zero.
  const span = bfCeiling - bulkStartBodyFat;
  const budgetUsedPct =
    span > 0 ? clamp(((bodyFat14dAvg - bulkStartBodyFat) / span) * 100, 0, 100) : 100;

  return {
    type: "lean_bulk",
    bfCeiling,
    evaluation: {
      currentWeight: weight7dAvg,
      gainedWeight: weight7dAvg - bulkStartWeight,
      budgetUsedPct,
      bodyFat14dAvg,
      currentBodyFat,
      startBodyFat: bulkStartBodyFat,
      bfCeiling,
      headroomPp: bfCeiling - bodyFat14dAvg,
    },
  };
}

// ─── Goal Status (the Decision Engine's "at target body fat?" slice) ─────────

/** How far past target (percentage points) body fat may drift back up before
 *  the "Start maintenance" directive releases. Exit-hysteresis only — entry is
 *  a plain `bf14 ≤ target`, this margin just stops the directive flickering
 *  when the 14-day average hovers on the line. */
export const GOAL_EXIT_MARGIN_PP = 0.3;

/** The engine's goal slice: is the cut's endpoint reached? Deliberately NOT a
 *  phase trigger (those ask "is the cut degrading?"); this asks "is the cut
 *  done?" — a goal judgment, so it lives with the goal math. */
export interface GoalStatusEvaluation {
  /** 14-day body-fat average at or under the configured target. */
  reached: boolean;
  bodyFat14dAvg: number | null;
  targetBodyFatPct: number | null;
}

/** Same 14-day smoothing as computeGoal's bodyFat14dAvg — one formula, so the
 *  directive and the Journey card can never disagree about "at goal". Missing
 *  target or too few body-fat readings → not reached (never a false claim). */
export function buildGoalStatus(metrics: BodyMetric[], targetBodyFatPct: number | null): GoalStatusEvaluation {
  const bfPts = metrics
    .filter((m) => m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: m.body_fat_pct as number }));
  const bodyFat14dAvg = rollingAvg(bfPts, 14, 0);
  const reached =
    targetBodyFatPct != null && bodyFat14dAvg != null && bodyFat14dAvg <= targetBodyFatPct;
  return { reached, bodyFat14dAvg, targetBodyFatPct };
}

// ─── Bulk Goal Status (the Decision Engine's "at the body-fat ceiling?" slice) ─

/** The bulk mirror of GoalStatusEvaluation: is the lean bulk's ENDPOINT reached?
 *  A bulk ends at a body-fat CEILING (bulk_bf_ceiling) rather than a floor —
 *  bf14 at or above it says the fat budget is spent and the next cut should
 *  start. Same 14-day smoothing and the same GOAL_EXIT_MARGIN_PP hysteresis,
 *  mirrored: once "Start the cut" shows, it holds until bf14 drops back below
 *  ceiling − margin. */
export interface BulkGoalStatusEvaluation {
  /** 14-day body-fat average at or above the configured ceiling. */
  reached: boolean;
  bodyFat14dAvg: number | null;
  bfCeilingPct: number | null;
}

export function buildBulkGoalStatus(
  metrics: BodyMetric[],
  bfCeilingPct: number | null,
): BulkGoalStatusEvaluation {
  const bfPts = metrics
    .filter((m) => m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: m.body_fat_pct as number }));
  const bodyFat14dAvg = rollingAvg(bfPts, 14, 0);
  const reached =
    bfCeilingPct != null && bodyFat14dAvg != null && bodyFat14dAvg >= bfCeilingPct;
  return { reached, bodyFat14dAvg, bfCeilingPct };
}

// ─── Body-Fat Trend Evaluation (the bulk's "is the gain mostly fat?" slice) ──

/** pp/month of body-fat RISE before a bulk's "reduce surplus" evidence counts.
 *  Mirror of the lean-mass falling detector's dull bar: gaining the band's max
 *  (0.3 kg/wk at ~90 kg) ENTIRELY as fat would be ≈ +1 pp/month, so a sustained
 *  ≥0.8 says most of the gain is fat — not just BIA scatter. */
const BULK_BF_RISE_PP_PER_MONTH = 0.8;

export interface BodyFatTrendEvaluation {
  trend: "stable" | "rising";
  /** Fitted body-fat slope over the trailing window, pp/month; null when there
   *  aren't enough readings to fit a trend. */
  slopePpPerMonth: number | null;
  confidence: "low" | "high";
}

/** Body-fat % trend over the same 60-day window / SE-significance gate as
 *  buildLeanMassEvaluation (BIA body fat is the same noisy input, so the same
 *  guards apply). "rising" requires the upslope to be BOTH materially positive
 *  AND ≥ K standard errors above flat; anything less is a low-confidence
 *  "stable" that never fires engine advice. Evaluation-layer only — this NEVER
 *  colours a lean-mass or body-fat delta in the UI (LBM stays context). */
export function buildBodyFatTrendEvaluation(metrics: BodyMetric[]): BodyFatTrendEvaluation {
  const bfPts = metrics
    .filter((m) => m.body_fat_pct != null)
    .map((m) => ({ date: m.metric_date, value: m.body_fat_pct as number }));

  const fit = olsFit(bfPts, LEAN_MASS_WINDOW_DAYS, LEAN_MASS_MIN_POINTS);
  if (!fit) return { trend: "stable", slopePpPerMonth: null, confidence: "low" };

  const slopePpPerMonth = +(fit.slopePerDay * 30).toFixed(3);
  const sePerMonth = fit.seSlopePerDay * 30;
  const rising =
    slopePpPerMonth >= BULK_BF_RISE_PP_PER_MONTH &&
    slopePpPerMonth >= LEAN_MASS_SIGNIF_K * sePerMonth;

  return { trend: rising ? "rising" : "stable", slopePpPerMonth, confidence: rising ? "high" : "low" };
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

type LeanMassTrend = "stable" | "falling";

export interface LeanMassEvaluation {
  trend: LeanMassTrend;
  /** Fitted lean-mass slope over the trailing window, kg/month; null when there
   *  aren't enough readings to fit a trend. */
  slopePerMonth: number | null;
  confidence: "low" | "high";
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

  const fit = olsFit(lmPts, LEAN_MASS_WINDOW_DAYS, LEAN_MASS_MIN_POINTS);
  if (!fit) return { trend: "stable", slopePerMonth: null, confidence: "low" };

  const slopePerMonth = +(fit.slopePerDay * 30).toFixed(3);
  const sePerMonth = fit.seSlopePerDay * 30;
  const falling =
    slopePerMonth <= LEAN_MASS_FALL_KG_PER_MONTH &&
    slopePerMonth <= -LEAN_MASS_SIGNIF_K * sePerMonth;

  return { trend: falling ? "falling" : "stable", slopePerMonth, confidence: falling ? "high" : "low" };
}
