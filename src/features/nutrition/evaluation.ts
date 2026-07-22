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

import { theilSenSlope, median, weightAcceleration } from "@features/health/math";
import { clamp01 } from "@shared/lib/num";
import { PHASE_TARGET_RANGES } from "./targetRanges";
import { phaseDirection, phaseKindFromName, type PhaseKind } from "./logic";

export type EvalStatus = "below_target" | "on_target" | "above_target";
export type Confidence = "low" | "medium" | "high";

export interface NutritionEvaluation {
  /** Progress vs the band, in the PHASE DIRECTION: below_target = slower than
   *  the planned rate (losing/gaining too slowly), above_target = faster. */
  status: EvalStatus;
  /** Observed weekly weight change, kg/week. Negative = losing. */
  observedRate: number;
  /** Acceptable weekly-rate band for the current phase — positive magnitudes
   *  in the phase direction (loss on a cut, gain on a bulk). */
  targetRange: { min: number; max: number };
  /** Derived from cutMode (never persisted; rowToState rebuilds it) — the
   *  single polarity source every judgment/tone consumer reads. */
  phaseKind: PhaseKind;
  confidence: Confidence;
  /** ISO timestamp of when this evaluation was produced. */
  evaluatedAt: string;
  /** Second-order rate trend (from weightAcceleration): is the loss speeding up
   *  ("faster") or slowing toward a plateau ("slowing")? null when it can't speak
   *  — holding inside the deadband, <5 readings, or the prior window wasn't a
   *  loss. Descriptive: drives the pace arrow's glyph + severity, never the
   *  judgment (status/confidence). Computed on a separate 14+14d window from the
   *  21d observedRate, so the two can legitimately diverge (that's the point —
   *  the band can read fine while the rate quietly slows). */
  accelDirection: "faster" | "slowing" | null;
}

export interface NutritionDiagnostics {
  estimatedTdee: number;
  /** TDEE + observed energy balance implied by the weight trend, kcal/day. */
  estimatedIntake: number;
  /** estimatedIntake − calorieTarget. Descriptive; never triggers a change. */
  intakeDifference: number;
  /** Mean daily logged intake over the window, kcal/day (null = too few logged
   *  days to compare). The food-log counterpart to estimatedIntake. Descriptive. */
  loggedIntake: number | null;
  /** estimatedIntake − loggedIntake, kcal/day (null when loggedIntake is null). A
   *  large magnitude means the weight trend and the food log disagree → confidence
   *  is capped below high. Descriptive; the cap itself lives on `confidence`. */
  intakeGap: number | null;
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
  /** Mean daily logged intake (kcal) over the trend window, or null when too few
   *  days are logged to compare. Lets a food-log ↔ weight-trend disagreement
   *  temper confidence; null = no food-log signal, no effect. */
  loggedIntake?: number | null;
  /** Injected for determinism/testability. */
  now: Date;
}

/** Energy density of body mass — the constant that converts a weekly rate into a
 *  daily kcal gap. Exported so the engine sizes its thresholds off the same
 *  number rather than re-deriving 7700 with its own rounding. */
export const KCAL_PER_KG = 7700;
export const WINDOW_DAYS = 21;
/** Minimum weight readings in the window before a trend can be fit (mirrors
 *  theilSenSlope's own guard). Below this, `evaluate` falls back to
 *  observedRate = 0 — a placeholder, not a measurement — so surfaces should
 *  render the rate as "—" rather than a fabricated "0.00 kg/wk". */
export const MIN_TREND_POINTS = 5;
/** kg/week deadband around the range edges so the status doesn't flap. */
export const STATUS_EPS = 0.02;
/** Days a NEW calorie target must be held before the 21-day weight trend can be
 *  a HIGH-confidence verdict on it. Below this, the trailing trend is still partly
 *  the PRIOR target, and weight right after a deficit change carries transient
 *  water/glycogen — so a fast rate reads as optimistic, not settled. */
const FRESH_TARGET_DAYS = 14;

/** kcal/day the weight-implied intake may differ from the logged intake before
 *  the two sources are "materially disagreeing". Now used only DESCRIPTIVELY — the
 *  `intakeDivergence` flag and the smooth `intake` vector component — never to gate
 *  the confidence label (see confidenceBreakdown: imprecise logs shouldn't distrust a
 *  clean weight trend). Conservative, uncalibrated default. */
const INTAKE_DIVERGENCE_KCAL = 200;

/** Canonical weekly weight rate (kg/week) — the exact number the UI's "Trend"
 *  shows: a Theil–Sen (median-of-pairwise-slopes) fit over the same trailing
 *  21-day window `evaluate` uses for `observedRate`, so a cheat day or creatine
 *  step can't tilt it. Any surface that reports a weekly rate (Overview
 *  card, AI export) must call this so they can never disagree. Returns null
 *  (not a fabricated 0) when the window has too few readings to fit a trend. */
export function weeklyWeightRate(weightSeries: { date: string; value: number }[]): {
  ratePerWeekKg: number | null;
  windowDays: number;
  dataPoints: number;
} {
  const slope = theilSenSlope(weightSeries, WINDOW_DAYS);
  return {
    ratePerWeekKg: slope == null ? null : +slope.toFixed(3),
    windowDays: WINDOW_DAYS,
    dataPoints: windowPoints(weightSeries, WINDOW_DAYS).length,
  };
}

/** Points falling inside the trailing `days` window (mirrors theilSenSlope). */
function windowPoints(pts: { date: string; value: number }[], days: number) {
  const last = pts.at(-1)?.date;
  if (!last) return [];
  const cutoff = new Date(last + "T12:00:00");
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return pts.filter((p) => p.date >= cutoffStr);
}

/** Mean absolute residual (kg) around the fitted trend line in the window —
 *  a low value means the trend is clean, so the observed rate is trustworthy.
 *  Anchored to a MEDIAN intercept (the Theil–Sen companion to the median slope):
 *  an outlier then surfaces as one large residual that raises scatter — correctly
 *  flagging the window as noisier — instead of dragging a mean-anchored line to
 *  hide itself. On clean/linear data the two anchorings coincide (residuals 0). */
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
  const intercept = median(ys.map((y, i) => y - slopePerDay * xs[i]));
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
export function longestGap(pts: { date: string; value: number }[], days: number): number {
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

/** Continuous 0–1 per-source confidence signals — the same inputs the low/medium/
 *  high label is built from, but un-bucketed so an LLM (the AI export's reader) can
 *  weigh them. Each answers "how much does THIS signal support trusting the weight
 *  verdict?". Descriptive only; the discrete `label` is what gates the decision. */
interface ConfidenceComponents {
  /** Days held on the current target — a fresh target's trend is half the prior
   *  one, so it earns confidence only as it settles (0 = just changed → 1 = ≥14d). */
  freshness: number;
  /** Enough, well-distributed weight readings — the point count, dragged down by
   *  the largest interior gap (a hole makes the fit a two-cluster lever arm). */
  weightData: number;
  /** Trend cleanliness — low scatter around the fitted line (1 = dead-on linear). */
  trend: number;
  /** Food-log ↔ weight-implied intake agreement (1 = agree → 0 as they diverge).
   *  null = too few logged days to compare, so it doesn't count toward the score. */
  intake: number | null;
}

export interface ConfidenceBreakdown {
  /** The discrete label that actually gates the decision — the single source of
   *  truth (`computeConfidence` returns exactly this). */
  label: Confidence;
  components: ConfidenceComponents;
  /** Mean of the present components (0–1) BEFORE the hard caps — "what the raw
   *  signals alone would give". A cap can hold `label` below what this implies. */
  rawScore: number;
  /** `freshTarget` = the one hard cap that still GATES (held the label to medium
   *  because the target is <14d old). `intakeDivergence` is INFORMATIONAL ONLY — a
   *  flag that the food log and weight-implied intake disagree by ≥INTAKE_DIVERGENCE_KCAL;
   *  it no longer lowers the label (imprecise logs shouldn't distrust a clean trend). */
  caps: { freshTarget: boolean; intakeDivergence: boolean };
}

const round2 = (x: number): number => +x.toFixed(2);

/** Confidence combines three signals (each 0–2): how long the user has held the
 *  current target, how much *well-distributed* weight data backs the trend, and how
 *  clean the trend is. Sum 0–6 → low / medium / high, then two hard caps. Returns
 *  BOTH the gating label (unchanged behaviour) and the continuous per-source vector
 *  the AI export exposes. */
export function confidenceBreakdown(
  daysOnTarget: number,
  weightDataPoints: number,
  gapDays: number,
  scatter: number,
  intakeGap: number | null,
): ConfidenceBreakdown {
  // ── Discrete score (the gating label) — integer buckets, behaviour-preserving ──
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
  const base: Confidence = score >= 5 ? "high" : score >= 3 ? "medium" : "low";

  // Hard cap on a FRESH target: however clean and dense the weight data, a 21-day
  // trend on a target held < FRESH_TARGET_DAYS is still half the PRIOR target and
  // carries transient water/glycogen from the deficit change — so a fast rate
  // isn't yet a settled verdict on THIS target. Hold at medium ("Forming") until
  // it's had ~2 weeks to express itself.
  const freshCap = base === "high" && daysOnTarget < FRESH_TARGET_DAYS;
  // Food-log divergence — INFORMATIONAL ONLY, does NOT gate the label. Logging is
  // inherently imprecise (you don't lab-test every meal), so a persistent log↔weight
  // gap is an *expected* constant offset, not a reason to distrust an independent,
  // clean weight trend. It once capped confidence to medium; that punished imprecise
  // logging and — since a real target change needs HIGH confidence — silently
  // stopped the engine from ever acting. We surface the flag (an LLM/reader can weigh
  // it) but the weight verdict stands on its own. Null gap = no food-log signal.
  const intakeDiverges =
    intakeGap != null && Math.abs(intakeGap) >= INTAKE_DIVERGENCE_KCAL;
  const label: Confidence = base === "high" && freshCap ? "medium" : base;

  // ── Continuous vector (descriptive) — smooth versions of the same signals ──────
  const freshness = clamp01(daysOnTarget / FRESH_TARGET_DAYS);
  // Count ramps to 1 at 14 readings; a gap linearly discounts it (≤3d none, ≥7d
  // everything) — the smooth twin of the min(count, gapBucket) rule above.
  const weightData = Math.min(clamp01(weightDataPoints / 14), clamp01((7 - gapDays) / 4));
  // scatter 0 → 1, 0.8 kg → 0 (the outer bucket edge).
  const trend = clamp01(1 - scatter / 0.8);
  // gap 0 → 1, twice the divergence bar → 0 (so the cap edge sits at 0.5).
  const intake =
    intakeGap == null ? null : clamp01(1 - Math.abs(intakeGap) / (2 * INTAKE_DIVERGENCE_KCAL));

  const present = [freshness, weightData, trend, ...(intake == null ? [] : [intake])];
  const rawScore = present.reduce((s, v) => s + v, 0) / present.length;

  return {
    label,
    components: {
      freshness: round2(freshness),
      weightData: round2(weightData),
      trend: round2(trend),
      intake: intake == null ? null : round2(intake),
    },
    rawScore: round2(rawScore),
    caps: { freshTarget: freshCap, intakeDivergence: intakeDiverges },
  };
}

/** The gating label alone (the decision path only needs this). */
function computeConfidence(
  daysOnTarget: number,
  weightDataPoints: number,
  gapDays: number,
  scatter: number,
  intakeGap: number | null,
): Confidence {
  return confidenceBreakdown(daysOnTarget, weightDataPoints, gapDays, scatter, intakeGap).label;
}

/** Confidence breakdown recomputed straight from a weight series — the export's
 *  entry point, so it can surface the full vector without the persisted row (which
 *  stores only the collapsed label). Mirrors `evaluate`'s own derivation of slope /
 *  scatter / gap exactly, so the label it reports matches the app's. `intakeGap` is
 *  the food-log ↔ weight-implied disagreement (null when too few logged days). */
export function confidenceBreakdownFromSeries(
  weightSeries: { date: string; value: number }[],
  daysOnTarget: number,
  intakeGap: number | null,
): ConfidenceBreakdown {
  const slope = theilSenSlope(weightSeries, WINDOW_DAYS);
  const weightDataPoints = windowPoints(weightSeries, WINDOW_DAYS).length;
  const gapDays = longestGap(weightSeries, WINDOW_DAYS);
  const scatter = slope == null ? Infinity : trendScatter(weightSeries, WINDOW_DAYS, slope);
  return confidenceBreakdown(daysOnTarget, weightDataPoints, gapDays, scatter, intakeGap);
}

export interface TdeeCalibration {
  /** The TDEE the calorie target is built on (config.tdee). */
  assumedTdee: number;
  /** HealthKit-measured TDEE (30d resting + 14d active) — independent of the food log. */
  measuredHealthTdee: number;
  /** TDEE implied by the food log + weight trend: loggedIntake − the trend's energy
   *  balance. NOT a peer of measuredHealthTdee: it rides on loggedIntake, the softest
   *  input (self-report is systematically UNDER-counted), so it inherits that error. A
   *  soft cross-check, not a second sensor reading — weigh it below the HealthKit burn. */
  measuredLogTdee: number;
  /** Conservative signed miscalibration (kcal/day): the smaller-magnitude of the two
   *  corroborating deltas. +ve = you burn MORE than the target assumes (real deficit
   *  is bigger than planned); −ve = you burn less. 0 unless both sources corroborate. */
  delta: number;
  /** "under"/"over" only when BOTH independent sources agree in direction AND both
   *  clear TDEE_MISCALIBRATION_KCAL. "aligned" = both within the bar (assumed TDEE
   *  looks right). "unclear" = they disagree or only one crosses — not enough to claim. */
  status: "aligned" | "under" | "over" | "unclear";
  /** Where a divergence most likely originates, ranked by the reliability hierarchy
   *  (weight trend hard > HealthKit burn > food log). "tdee" = the SENSOR corroborates
   *  that the assumed TDEE is off (status is under/over) → the target's TDEE is the
   *  culprit. "under-logging"/"over-logging" = the measured HealthKit burn backs the
   *  assumed TDEE and only the log-implied number diverges → the gap rides on the soft
   *  log, so the log is the suspect, NOT the TDEE (the common case: habitual
   *  under-reporting). null = aligned, no measured burn to attribute against, or the
   *  user asserted complete logging (see possibleCauses). */
  likelyCause: "tdee" | "under-logging" | "over-logging" | null;
  /** Populated ONLY when a lone log divergence was left unattributed because the user
   *  asserted complete logging (assume_complete_logging): the candidate explanations,
   *  ordered by nothing — the reader weighs them, LiftOS makes no pick. */
  possibleCauses: string[] | null;
  /** True when assumedTdee IS the HealthKit estimate — the app-open auto-sync
   *  (NutritionConfigContext) writes it verbatim while it stays in-band, so
   *  dHealth ≈ 0 by construction. Then measuredHealthTdee is NOT an independent
   *  check on assumedTdee and the calibration reduces to a two-source read:
   *  HealthKit burn vs the log+weight-implied TDEE. */
  assumedTdeeSyncedToHealth: boolean;
  /** Reader-facing caveat, set only when assumedTdeeSyncedToHealth — travels in
   *  the JSON export so an external reader can't count the assumedTdee ↔
   *  measuredHealthTdee agreement as corroboration. */
  note: string | null;
}

/** kcal/day a MEASURED TDEE must exceed the target's assumed TDEE before we'll
 *  surface a miscalibration claim. Deliberately above INTAKE_DIVERGENCE_KCAL (the
 *  confidence-cap bar): capping trust is cheap, but *telling* the user the target is
 *  built on a wrong number should need a wider, corroborated gap. */
const TDEE_MISCALIBRATION_KCAL = 250;

/** Is the target's assumed TDEE (config.tdee) still consistent with reality?
 *  Compares it against two INDEPENDENT measured estimates — HealthKit burn, and the
 *  TDEE implied by (food log + weight trend) — and only claims a miscalibration when
 *  BOTH agree in direction and both clear TDEE_MISCALIBRATION_KCAL. Requiring
 *  corroboration is the guard against a single fat logging week or a HealthKit blip
 *  moving the verdict.
 *
 *  `likelyCause` then attributes any divergence by the reliability hierarchy — the
 *  food log is the SOFTEST input (self-report, systematically under-counted), so when
 *  the measured HealthKit burn backs the assumed TDEE and only the log-implied number
 *  diverges, the log is the suspect, not the TDEE. Doubting the TDEE is warranted only
 *  when the sensor itself corroborates it (status under/over).
 *
 *  Caveat on "independent": NutritionConfigContext auto-syncs config.tdee to the
 *  HealthKit estimate on app open, so whenever HealthKit data exists dHealth ≈ 0 by
 *  construction — the sensor "backing" the assumption is largely the same number, and
 *  in practice the calibration reduces to sensor-vs-log with the sensor hard-trusted.
 *  assumeCompleteLogging exists precisely so the user can veto that trust ordering.
 *  That circularity is surfaced to the reader as assumedTdeeSyncedToHealth + note,
 *  so the export can't be misread as two sources backing the assumed TDEE.
 *
 *  Inform-only: never proposes a calorie change — it hands the numbers to the reader
 *  (the AI export's audit). Returns null when there isn't enough to judge: no trusted
 *  weight trend, or no food-log signal. */
export function tdeeCalibration(input: {
  assumedTdee: number;
  estimatedTdee: number;
  /** True when estimatedTdee is a genuine HealthKit measurement (30d resting + 14d
   *  active), false when it fell back to the assumed TDEE (no HealthKit energy data).
   *  Only a real measurement can BACK the assumption, which is what lets a lone
   *  log divergence be pinned on logging rather than left unattributed. */
  healthTdeeMeasured: boolean;
  loggedIntake: number | null;
  observedRate: number | null;
  /** Weight trend is dense/clean enough to imply a TDEE (else the log-implied number
   *  is noise). Caller passes weightDataPoints ≥ MIN_TREND_POINTS && confidence != low. */
  weightTrustworthy: boolean;
  /** User assertion (config.assume_complete_logging): the food log is complete.
   *  Removes the "self-report is under-counted" prior — a lone log divergence then
   *  yields possibleCauses instead of an under-/over-logging attribution. */
  assumeCompleteLogging?: boolean;
}): TdeeCalibration | null {
  const { assumedTdee, estimatedTdee, healthTdeeMeasured, loggedIntake, observedRate, weightTrustworthy } =
    input;
  // The log-implied TDEE needs BOTH a trusted weight trend and a food-log signal;
  // it's also the corroborating second source. Missing either → no independent
  // cross-check, so stay silent rather than claim on one source.
  if (!weightTrustworthy || loggedIntake == null || observedRate == null) return null;

  const impliedFromLog = loggedIntake - (observedRate * KCAL_PER_KG) / 7;
  const dHealth = estimatedTdee - assumedTdee;
  const dLog = impliedFromLog - assumedTdee;

  // The auto-sync writes the HealthKit estimate into config.tdee verbatim, so
  // integer equality is its signature. When it holds, "the sensor backs the
  // assumption" is vacuous — flag it so readers don't count the same reading twice.
  const syncedToHealth =
    healthTdeeMeasured && Math.round(assumedTdee) === Math.round(estimatedTdee);

  const healthClears = Math.abs(dHealth) >= TDEE_MISCALIBRATION_KCAL;
  const logClears = Math.abs(dLog) >= TDEE_MISCALIBRATION_KCAL;
  const bothClear = healthClears && logClears;
  const agree = Math.sign(dHealth) === Math.sign(dLog);
  const bothSmall = !healthClears && !logClears;

  let delta = 0;
  let status: TdeeCalibration["status"];
  if (bothClear && agree) {
    // Report the smaller-magnitude delta — "off by AT LEAST this", never the rosier
    // of the two estimates.
    delta = Math.abs(dHealth) <= Math.abs(dLog) ? dHealth : dLog;
    status = delta > 0 ? "under" : "over";
  } else {
    status = bothSmall ? "aligned" : "unclear";
  }

  // Attribute the divergence by reliability. A corroborated under/over is the sensor
  // itself flagging the TDEE. Otherwise, if a REAL HealthKit burn backs the assumed
  // TDEE (dHealth small) and only the soft log-implied number diverges, the log is the
  // likely culprit — habitual under-reporting, not a wrong TDEE.
  let likelyCause: TdeeCalibration["likelyCause"] = null;
  let possibleCauses: string[] | null = null;
  if (status === "under" || status === "over") {
    likelyCause = "tdee";
  } else if (healthTdeeMeasured && !healthClears && logClears) {
    if (input.assumeCompleteLogging) {
      // The user vouches for the log, which removes the prior that let a lone log
      // divergence be pinned on logging. What remains is a sensor-vs-log conflict
      // this function has no third source to arbitrate — name the candidates and
      // let the reader weigh them.
      possibleCauses = [
        dLog < 0 ? "tdee-overestimated" : "tdee-underestimated",
        "water-weight-fluctuation-masking-trend",
        "food-logging-error",
      ];
    } else {
      likelyCause = dLog < 0 ? "under-logging" : "over-logging";
    }
  }

  return {
    assumedTdee: Math.round(assumedTdee),
    measuredHealthTdee: Math.round(estimatedTdee),
    measuredLogTdee: Math.round(impliedFromLog),
    delta: Math.round(delta),
    status,
    likelyCause,
    possibleCauses,
    assumedTdeeSyncedToHealth: syncedToHealth,
    note: syncedToHealth
      ? "assumedTdee is auto-synced to the HealthKit estimate on app open, so assumedTdee and measuredHealthTdee are the SAME reading, not two corroborating sources — do not read their agreement as evidence the assumed TDEE is right. Equally, do not read (measuredHealthTdee − measuredLogTdee) as the TDEE's error magnitude: measuredLogTdee inherits food-log estimation error AND short-window weight-trend noise (water/glycogen/sodium), so the gap is a flag to keep watching, not a measured correction. True TDEE may sit between the two numbers or nearer either one."
      : null,
  };
}

export function evaluate(input: EvaluateInput): NutritionState {
  const { weightSeries, cutMode, calorieTarget, estimatedTdee, daysOnTarget, now, loggedIntake = null } = input;
  const evaluatedAt = now.toISOString();
  const range = PHASE_TARGET_RANGES[cutMode] ?? null;
  const phaseKind = phaseKindFromName(cutMode);

  const slope = theilSenSlope(weightSeries, WINDOW_DAYS); // kg/week or null
  const observedRate = slope ?? 0;
  const weightDataPoints = windowPoints(weightSeries, WINDOW_DAYS).length;
  const gapDays = longestGap(weightSeries, WINDOW_DAYS);
  // Second-order read on the same series (its own 14+14d windows). Null unless
  // the rate has clearly moved — feeds the pace arrow, nothing else. Phase-
  // directed: "slowing" always means progress (loss OR gain) decelerating.
  const accelDirection =
    weightAcceleration(weightSeries, phaseDirection(phaseKind))?.direction ?? null;

  // Diagnostics: what intake the weight trend implies, vs the target. The energy
  // balance from the trend (observedRate kg/wk × 7700 kcal/kg ÷ 7 days) added to
  // TDEE gives the estimated actual daily intake.
  const estimatedIntake = Math.round(estimatedTdee + (observedRate * KCAL_PER_KG) / 7);
  const loggedIntakeRounded = loggedIntake != null ? Math.round(loggedIntake) : null;
  const intakeGap = loggedIntakeRounded != null ? estimatedIntake - loggedIntakeRounded : null;
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: Math.round(estimatedTdee),
    estimatedIntake,
    intakeDifference: Math.round(estimatedIntake - calorieTarget),
    loggedIntake: loggedIntakeRounded,
    intakeGap,
    calorieTarget: Math.round(calorieTarget),
    cutMode,
    windowDays: WINDOW_DAYS,
    weightDataPoints,
    longestGap: gapDays,
    daysOnTarget,
  };

  // No band for this phase, or not enough weight data to fit a trend → we
  // can't judge. Return a neutral, low-confidence evaluation.
  if (!range || slope == null) {
    return {
      evaluation: {
        status: "on_target",
        observedRate,
        targetRange: range ?? { min: 0, max: 0 },
        phaseKind,
        confidence: "low",
        evaluatedAt,
        accelDirection,
      },
      diagnostics,
    };
  }

  // Judge the rate against the band IN THE PHASE DIRECTION: observedRate is
  // negative while losing, so on a cut progress = −observedRate (the loss) and
  // on a bulk progress = +observedRate (the gain). Below the band = moving too
  // slowly for the plan, whichever way the plan points.
  const progress = phaseDirection(phaseKind) * observedRate;
  const status: EvalStatus =
    progress < range.min - STATUS_EPS ? "below_target"
    : progress > range.max + STATUS_EPS ? "above_target"
    : "on_target";

  const confidence = computeConfidence(
    daysOnTarget,
    weightDataPoints,
    gapDays,
    trendScatter(weightSeries, WINDOW_DAYS, slope),
    intakeGap,
  );

  return {
    evaluation: { status, observedRate, targetRange: range, phaseKind, confidence, evaluatedAt, accelDirection },
    diagnostics,
  };
}

