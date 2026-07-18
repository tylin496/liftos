import type { BodyMetric } from "./api";
import { localDateStr } from "@shared/lib/date";
import { isStale } from "@shared/lib/freshness";
import { olsFit } from "@shared/lib/stats";

export type MetricKey =
  | "weight_kg"
  | "body_fat_pct"
  | "active_energy_kcal"
  | "resting_energy_kcal"
  | "exercise_minutes"
  | "sleep_seconds"
  | "resting_heart_rate"
  | "hrv_sdnn_ms";

// Known Shortcut ingestion quirk: body-fat has occasionally arrived as a raw
// fraction (0.22 instead of 22) or otherwise out of range. A single bad day
// poisons the rolling average and corrupts derived Lean Mass. Filtered at the
// read boundary — NOT inside bucketSeries (which stays a pure averaging fn).
// Shared here so every consumer (Health page, AI export) treats the same
// samples as invalid; a value that never reaches a chart must never reach the
// export summary either.
const MIN_PLAUSIBLE_BODY_FAT_PCT = 3;
const MAX_PLAUSIBLE_BODY_FAT_PCT = 60;

function isImplausibleBodyFat(pct: number): boolean {
  return pct < MIN_PLAUSIBLE_BODY_FAT_PCT || pct > MAX_PLAUSIBLE_BODY_FAT_PCT;
}

/** Nulls out implausible body-fat samples (treats that day as "no reading").
 *  Never clamps to the boundary — that would fabricate a plausible-looking
 *  but wrong value. Weight and all other metrics pass through untouched. */
export function sanitizeMetrics(metrics: BodyMetric[]): BodyMetric[] {
  return metrics.map((m) =>
    m.body_fat_pct != null && isImplausibleBodyFat(m.body_fat_pct)
      ? { ...m, body_fat_pct: null }
      : m,
  );
}

export function countSkippedBodyFat(metrics: BodyMetric[]): number {
  return metrics.filter(
    (m) => m.body_fat_pct != null && isImplausibleBodyFat(m.body_fat_pct),
  ).length;
}

export interface ChartPoint {
  date: string;       // representative (middle) date — used for x positioning
  dateStart: string;  // first day covered by this bucket
  dateEnd: string;    // last day covered by this bucket
  value: number;
}

export interface BucketOptions {
  /** Visible window: keep only the last `spanDays`, anchored on the latest reading. */
  spanDays: number;
  /** Averaging window per point, stepping backward from the latest reading. */
  bucketDays: number;
}

export function series(metrics: BodyMetric[], key: MetricKey) {
  return metrics
    .map((m) => ({ date: m.metric_date, value: m[key] as number | null }))
    .filter((p): p is { date: string; value: number } => p.value != null);
}

/** Sync-write timestamp of a metric's latest reading — feeds FreshnessTag's
 *  same-day clock time. Walks from the end so it lands on the row that
 *  actually carries this key, not just the newest row overall. */
export function latestUpdatedAt(metrics: BodyMetric[], key: MetricKey): string | null {
  for (let i = metrics.length - 1; i >= 0; i--) {
    if (metrics[i][key] != null) return metrics[i].updated_at;
  }
  return null;
}

export function bucketSeries(
  pts: { date: string; value: number }[],
  { spanDays, bucketDays }: BucketOptions,
): ChartPoint[] {
  if (!pts.length) return [];

  const MS = 86400000;
  // Everything anchors on the most recent reading: the visible window is the
  // last `spanDays`, and buckets step backward in `bucketDays` chunks from
  // there. So the final bucket is always "the latest `bucketDays` days" — the
  // exact window the Card headline (rollingAvg) shows, so the final point and
  // the Card number always match. The old epoch grid snapped to arbitrary fixed
  // calendar weeks, which let the final point cover a different span.
  const anchor = new Date(pts.at(-1)!.date + "T12:00:00").getTime();
  const spanCutoff = anchor - (spanDays - 1) * MS;
  const inSpan = pts.filter((p) => new Date(p.date + "T12:00:00").getTime() >= spanCutoff);
  if (!inSpan.length) return [];

  if (bucketDays <= 1) {
    return inSpan.map((p) => ({ date: p.date, dateStart: p.date, dateEnd: p.date, value: p.value }));
  }

  const buckets = new Map<number, { dates: string[]; values: number[] }>();
  for (const p of inSpan) {
    const t = new Date(p.date + "T12:00:00").getTime();
    const idx = Math.floor((anchor - t) / (MS * bucketDays));
    if (!buckets.has(idx)) buckets.set(idx, { dates: [], values: [] });
    buckets.get(idx)!.dates.push(p.date);
    buckets.get(idx)!.values.push(p.value);
  }
  // idx 0 = newest bucket, larger idx = older — sort descending so the array
  // runs oldest → newest (left → right on the chart).
  return [...buckets.keys()]
    .sort((a, b) => b - a)
    .map((k) => {
      const { dates, values } = buckets.get(k)!;
      // dates arrive oldest → newest, so [0] / last bound the week
      return {
        date: dates[Math.floor(dates.length / 2)],
        dateStart: dates[0],
        dateEnd: dates[dates.length - 1],
        value: values.reduce((s, v) => s + v, 0) / values.length,
      };
    });
}

/** Values inside the trailing window `days` long ending `offsetDays` before the
 *  latest point — shared by rollingAvg and rollingBand so the average and its
 *  spread always read the exact same window. */
function windowValues(pts: { date: string; value: number }[], days: number, offsetDays: number): number[] {
  if (!pts.length) return [];
  const last = pts.at(-1)!.date;
  const end = new Date(last + "T12:00:00");
  end.setDate(end.getDate() - offsetDays);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  const endStr = end.toISOString().slice(0, 10);
  const startStr = start.toISOString().slice(0, 10);
  return pts.filter((p) => p.date >= startStr && p.date <= endStr).map((p) => p.value);
}

export function rollingAvg(pts: { date: string; value: number }[], days = 7, offsetDays = 0): number | null {
  const vals = windowValues(pts, days, offsetDays);
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export interface Band {
  lo: number;
  hi: number;
}

const MIN_BAND_POINTS = 5;

/** Normal range = mean ± 1 SD over the same trailing window the baseline
 *  averages (~68% of readings land inside it). Null under MIN_BAND_POINTS
 *  readings — a band built from a handful of days asserts a "normal" that
 *  doesn't exist yet, so consumers fall back to baseline-only. */
export function rollingBand(pts: { date: string; value: number }[], days = 30, offsetDays = 1): Band | null {
  const vals = windowValues(pts, days, offsetDays);
  if (vals.length < MIN_BAND_POINTS) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  return { lo: mean - sd, hi: mean + sd };
}

/** Trailing rolling average keyed by hours, not calendar days — smooths a
 *  daily-granularity series (e.g. the Overview weight trend line) without the
 *  day-boundary snap `rollingAvg` uses. Returns one averaged point per input
 *  point, each looking only backward (no future leakage), so slicing the
 *  output to a recent window still reflects smoothing informed by history
 *  just outside it. */
export function trailingAvg(
  pts: { date: string; value: number }[],
  windowHours: number,
): { date: string; value: number }[] {
  const MS = windowHours * 3600000;
  const times = pts.map((p) => new Date(p.date + "T12:00:00").getTime());
  return pts.map((p, i) => {
    const end = times[i];
    const start = end - MS;
    let sum = 0, count = 0;
    for (let j = 0; j <= i; j++) {
      if (times[j] < start) continue;
      sum += pts[j].value;
      count++;
    }
    return { date: p.date, value: sum / count };
  });
}

export type RecoveryStatus = "Ready" | "Good" | "Fair" | "Needs Recovery";

const MIN_VALID_SLEEP_SECONDS = 3 * 60 * 60;

/** Status → semantic color token. Shared by the Health card and the Overview
 *  card so the four tiers always read the same color. */
export const RECOVERY_STATUS_COLOR: Record<RecoveryStatus, string> = {
  Ready:              "var(--good)",
  Good:               "var(--good)",
  Fair:               "var(--warn)",
  "Needs Recovery":   "var(--bad)",
};

export interface RecoverySnapshot {
  sleepHours: number | null;
  hrv: number | null;
  rhr: number | null;
  sleepBaseline: number | null;
  hrvBaseline: number | null;
  rhrBaseline: number | null;
  /** 30-day normal range (mean ± 1 SD) per metric — null until enough readings */
  sleepBand: Band | null;
  hrvBand: Band | null;
  rhrBand: Band | null;
  /** 0–3: how many metrics are at or above their personal baseline */
  score: number;
  status: RecoveryStatus | null;
  /** true when there are readings but NO 30-day baseline yet to grade against
   *  (new user, <30 days) — status is withheld (null) and the card shows a
   *  neutral "building baseline" note instead of a verdict. */
  baselineBuilding: boolean;
  /** one-line, informational read on recent recovery vs. baseline */
  insight: string | null;
  /** date string of the most recent reading used */
  date: string | null;
  /** sync-write timestamp of the row at `date` — feeds FreshnessTag's same-day clock time */
  updatedAt: string | null;
  /** true when `date` is past the recovery freshness window — the reading is too
   *  old to assess readiness from. Consumers show a neutral "can't assess" state
   *  (never vanish, never alarm) and the engine treats recovery as unknown. */
  stale: boolean;
  /** For a *low* readiness reading only, its likely cause attributed from recent
   *  training load (null otherwise, or when there's no exercise data). Context,
   *  never a verdict — it never moves the 0–3 score. See recoveryLoadContext. */
  loadContext: RecoveryLoadContext | null;
}

export function computeRecovery(metrics: BodyMetric[]): RecoverySnapshot {
  const sleepPts = series(metrics, "sleep_seconds");
  // Filters obvious HealthKit/incomplete sleep records, not genuine short sleep.
  const sleepBaselinePts = sleepPts.filter((p) => p.value >= MIN_VALID_SLEEP_SECONDS);
  const hrvPts   = series(metrics, "hrv_sdnn_ms");
  const rhrPts   = series(metrics, "resting_heart_rate");

  const sleepRaw = rollingAvg(sleepBaselinePts, 7, 0);
  const sleepHours = sleepRaw != null ? sleepRaw / 3600 : null;
  const hrv = rollingAvg(hrvPts, 7, 0);
  const rhr = rollingAvg(rhrPts, 7, 0);

  // Baseline = 30-day average before (not including) the latest reading
  const sleepBaseRaw = rollingAvg(sleepBaselinePts, 30, 1);
  const sleepBaseline = sleepBaseRaw != null ? sleepBaseRaw / 3600 : null;
  const hrvBaseline  = rollingAvg(hrvPts,  30, 1);
  const rhrBaseline  = rollingAvg(rhrPts,  30, 1);

  // Normal range over the same 30-day window the baseline averages
  const sleepBandRaw = rollingBand(sleepBaselinePts, 30, 1);
  const sleepBand = sleepBandRaw ? { lo: sleepBandRaw.lo / 3600, hi: sleepBandRaw.hi / 3600 } : null;
  const hrvBand = rollingBand(hrvPts, 30, 1);
  const rhrBand = rollingBand(rhrPts, 30, 1);

  // A marker counts AGAINST readiness only when it's gradeable (has both a value
  // and a 30-day baseline) AND sits below baseline. A marker with a value but no
  // baseline is NEUTRAL — the gauges render it neutral, so it must not read as a
  // miss (that would drop the score, e.g. one perfect sleep + two baseline-less
  // markers → false "Fair" against two neutral gauges). Score = 3 − (markers
  // actively below baseline): with full data it equals the old pass-count; with
  // partial data neutral markers neither help nor hurt.
  const sleepLow = sleepHours != null && sleepBaseline != null && sleepHours < sleepBaseline * 0.95;
  const hrvLow   = hrv != null && hrvBaseline != null && hrv < hrvBaseline * 0.95;
  const rhrHigh  = rhr != null && rhrBaseline != null && rhr > rhrBaseline * 1.05;
  const downCount = (sleepLow ? 1 : 0) + (hrvLow ? 1 : 0) + (rhrHigh ? 1 : 0);
  const score = 3 - downCount;

  const hasAny = sleepHours != null || hrv != null || rhr != null;
  // A reading with no 30-day baseline can't be graded (new user, <30 days of
  // history). Scoring it as a miss would falsely read "Needs Recovery" while the
  // gauges — which treat a missing baseline as neutral — show no problem. When we
  // have readings but NO baseline at all to compare against, withhold the verdict
  // entirely: status null → the card shows a neutral "building baseline" note and
  // the engine treats recovery as unknown. Once any baseline exists the normal
  // 0–3 verdict resumes.
  const hasBaseline = sleepBaseline != null || hrvBaseline != null || rhrBaseline != null;
  const baselineBuilding = hasAny && !hasBaseline;
  const status: RecoveryStatus | null = !hasAny || baselineBuilding ? null
    : score === 3 ? "Ready"
    : score === 2 ? "Good"
    : score === 1 ? "Fair"
    : "Needs Recovery";

  // Insight: a short, plain-language read of where the user's 7-day averages sit.
  // When a marker is off we name it (sleepLow/hrvLow/rhrHigh/downCount computed
  // above with the score); when everything's holding we surface the strongest
  // one. Descriptive, not prescriptive — it reflects the state, never prescribes.

  // Closing clause, driven by the overall status.
  const read =
    status === "Ready" ? "recovery looks solid"
    : status === "Good" ? "recovery's holding up"
    : status === "Fair" ? "recovery's a little down"
    : "recovery's running low";

  // Strongest marker above baseline (for the all-clear case). Only named when
  // it's meaningfully above (≥2%), so an at-baseline day doesn't claim "above".
  const above = [
    sleepHours != null && sleepBaseline != null
      ? { label: "Sleep",      dir: "above", mag: (sleepHours - sleepBaseline) / sleepBaseline } : null,
    hrv != null && hrvBaseline != null
      ? { label: "HRV",        dir: "above", mag: (hrv - hrvBaseline) / hrvBaseline } : null,
    rhr != null && rhrBaseline != null
      ? { label: "Resting HR", dir: "below", mag: (rhrBaseline - rhr) / rhrBaseline } : null,
  ].filter((c): c is { label: string; dir: string; mag: number } => c != null && c.mag >= 0.02)
    .sort((a, b) => b.mag - a.mag);

  let insight: string | null;
  if (!hasAny) insight = null;
  else if (downCount >= 2) insight = `Several 7-day averages are running below baseline — ${read}`;
  else if (sleepLow) insight = `Sleep 7-day average is running below baseline — ${read}`;
  else if (hrvLow) insight = `HRV 7-day average is running below baseline — ${read}`;
  else if (rhrHigh) insight = `Resting HR 7-day average is running above baseline — ${read}`;
  else if (above.length) insight = `${above[0].label} 7-day average is running ${above[0].dir} baseline — ${read}`;
  else insight = `Your 7-day averages are holding steady against baseline — ${read}`;
  // No baseline yet → the "vs baseline" read above is meaningless; the card shows
  // its own building-baseline note instead, so drop the insight entirely.
  if (baselineBuilding) insight = null;

  // Attribute a low reading to its likely cause via recent training load — the
  // one thing HRV/sleep/RHR can't distinguish. This shapes the read only; the
  // score above is untouched.
  const loadContext = recoveryLoadContext(status, recentTrainingLoad(metrics));
  if (insight != null && loadContext === "training-stress")
    insight += "; likely training fatigue after recent hard sessions";
  else if (insight != null && loadContext === "systemic")
    insight += "; with little recent training, more likely sleep or life stress";

  const dates = [sleepPts.at(-1)?.date, hrvPts.at(-1)?.date, rhrPts.at(-1)?.date]
    .filter((d): d is string => d != null);
  const date = dates.length ? dates.sort().at(-1)! : null;
  const stale = isStale("recovery", date);
  const updatedAt = date != null
    ? metrics.find((m) => m.metric_date === date)?.updated_at ?? null
    : null;

  return { sleepHours, hrv, rhr, sleepBaseline, hrvBaseline, rhrBaseline, sleepBand, hrvBand, rhrBand, score, status, baselineBuilding, insight, date, updatedAt, stale, loadContext };
}

// A day counts as "trained" at ≥20 exercise minutes; ≥2 such days in the trailing
// week means real recent load. Coarse on purpose — this only has to distinguish
// "there was training" from "there wasn't", which active energy can't (it folds in
// walking/NEAT). It's the discriminator, not a dose.
const TRAINED_MINUTES = 20;
const TRAINED_DAYS = 2;

/** Did the user train recently? "trained" / "rested" / null (no exercise data at
 *  all — never populated, so we can't claim either way). Anchored on the latest
 *  metric date so a stale exercise feed reads as "rested", not a phantom "trained". */
function recentTrainingLoad(metrics: BodyMetric[]): "trained" | "rested" | null {
  if (!metrics.length) return null;
  const pts = series(metrics, "exercise_minutes");
  if (!pts.length) return null;
  const anchor = new Date(metrics.at(-1)!.metric_date + "T12:00:00").getTime();
  const cutoff = anchor - 6 * 86400000; // trailing 7 days, inclusive of the anchor
  const week = pts.filter((p) => new Date(p.date + "T12:00:00").getTime() >= cutoff);
  const trainedDays = week.filter((p) => p.value >= TRAINED_MINUTES).length;
  return trainedDays >= TRAINED_DAYS ? "trained" : "rested";
}

/** Likely cause of a *low* readiness reading, attributed from recent training
 *  load — the discriminator HRV/sleep/RHR can't provide on their own. Low
 *  readiness right after real training is expected, transient training fatigue
 *  (a deload day resolves it); low readiness with little training points at
 *  sleep/life stress, which pushing or resting training won't fix. Null when
 *  readiness isn't down, or when there's no exercise data to attribute with.
 *  Context only — it never changes the 0–3 score. */
export type RecoveryLoadContext = "training-stress" | "systemic";
function recoveryLoadContext(
  status: RecoveryStatus | null,
  load: "trained" | "rested" | null,
): RecoveryLoadContext | null {
  if (status !== "Fair" && status !== "Needs Recovery") return null;
  if (load === "trained") return "training-stress";
  if (load === "rested") return "systemic";
  return null;
}

/** The recovery slice the recommendation registry consumes. A derived judgment
 *  (status + recent load), never raw numbers — the provider shapes it into an
 *  action without re-deriving anything. */
export interface RecoveryEvaluation {
  status: RecoveryStatus | null;
  score: number;
  trainingLoad: "trained" | "rested" | null;
}

export function buildRecoveryEvaluation(metrics: BodyMetric[]): RecoveryEvaluation {
  const rec = computeRecovery(metrics);
  // Recency gate: a stale readiness reading (past the recovery freshness window)
  // is reported as unknown, so no directive fires off week-old HRV/sleep/RHR. The
  // engine's "no data → no bad news" path then suppresses it — we never assert a
  // readiness verdict from data too old to trust.
  if (rec.stale) return { status: null, score: 0, trainingLoad: recentTrainingLoad(metrics) };
  return { status: rec.status, score: rec.score, trainingLoad: recentTrainingLoad(metrics) };
}

type AccelDirection = "slowing" | "faster";

export interface WeightAcceleration {
  /** Least-squares slope over the last 14 days (kg/week). */
  recentRatePerWeek: number;
  /** Slope over the 14 days before that (kg/week). */
  priorRatePerWeek: number;
  /** recent − prior. On a cut (both negative) a positive delta means the rate
   *  moved toward zero — losing *slower*; negative means losing *faster*. */
  deltaPerWeek: number;
  direction: AccelDirection;
  /** true once |delta| clears the strong threshold. */
  strong: boolean;
}

/** Window (days) for each half of the acceleration comparison. Symmetric so the
 *  two slopes have the same variance — a fair recent-vs-prior read. */
const ACCEL_WINDOW_DAYS = 14;
/** kg/week floor for the deadband: even with pristine data the delta must clear
 *  this before we call it a change. The *effective* deadband is the LARGER of
 *  this and the combined standard error of the two slopes (see weightAcceleration),
 *  so a noisy fortnight has to move further before the chip speaks. */
const ACCEL_MIN_DELTA = 0.1;
/** kg/week above which the change is a strong acceleration/deceleration. */
const ACCEL_STRONG_DELTA = 0.2;

/** Second-order weight read: is the loss accelerating or slowing? Compares a
 *  least-squares slope over the last 14 days against the 14 days before that.
 *  This is deliberately SEPARATE from the canonical 21-day `weeklyWeightRate`
 *  the card shows — that number answers "how fast" (level); this answers "which
 *  way is that rate itself moving" (trend of the level). A band-position pill
 *  (On pace / Too fast) can read fine while the rate is quietly slowing toward a
 *  plateau; this is the signal that catches that early.
 *
 *  Returns null when it can't speak: either window lacks a fittable trend
 *  (<5 readings), the prior window wasn't moving in the phase direction (a
 *  slowing/faster read is only meaningful against established progress), or
 *  the change is inside the steady deadband. Callers render nothing in those
 *  cases.
 *
 *  `direction` = the phase's sign on the scale (−1 cut/default: progress is a
 *  falling slope; +1 bulk: progress is a rising slope — see phaseDirection).
 *  "slowing"/"faster" always describe progress in THAT direction, so the pace
 *  arrow keeps one meaning across phases. */
export function weightAcceleration(
  pts: { date: string; value: number }[],
  direction: 1 | -1 = -1,
): WeightAcceleration | null {
  const recentFit = regressionFit(pts, ACCEL_WINDOW_DAYS);
  if (recentFit == null) return null;
  const last = pts.at(-1)?.date;
  if (!last) return null;
  // Prior half = the 14 days ending the day before the recent window opens.
  const priorEnd = new Date(last + "T12:00:00");
  priorEnd.setDate(priorEnd.getDate() - ACCEL_WINDOW_DAYS);
  const priorEndStr = priorEnd.toISOString().slice(0, 10);
  const priorFit = regressionFit(
    pts.filter((p) => p.date <= priorEndStr),
    ACCEL_WINDOW_DAYS,
  );
  if (priorFit == null) return null;
  const recent = recentFit.slopePerWeek;
  const prior = priorFit.slopePerWeek;
  // Only an established progress regime gives "slowing/faster" a stable
  // meaning: the prior window must have been moving in the phase direction
  // (losing on a cut, gaining on a bulk) — otherwise stay silent.
  if (direction * prior <= 0) return null;
  const deltaPerWeek = +(recent - prior).toFixed(3);
  // Noise-aware deadband. Each slope carries a standard error set by how much
  // the daily readings scatter around its line; the delta of two independent
  // slopes has SE = hypot(seRecent, sePrior). Requiring |delta| to clear that
  // (as well as the fixed floor) means we won't call it "slowing" when the
  // change is smaller than the error bar on the change itself — the exact case
  // where a fixed deadband flaps an amber chip on a fortnight of scale noise.
  const combinedSE = Math.hypot(recentFit.sePerWeek, priorFit.sePerWeek);
  if (Math.abs(deltaPerWeek) < Math.max(ACCEL_MIN_DELTA, combinedSE)) return null;
  // Express the change in PROGRESS space (positive = progress accelerating):
  // on a cut a delta toward zero/positive means the loss is slowing; on a bulk
  // a delta toward zero/negative means the gain is slowing.
  const progressDelta = direction * deltaPerWeek;
  return {
    recentRatePerWeek: +recent.toFixed(3),
    priorRatePerWeek: +prior.toFixed(3),
    deltaPerWeek,
    direction: progressDelta < 0 ? "slowing" : "faster",
    strong: Math.abs(deltaPerWeek) >= ACCEL_STRONG_DELTA,
  };
}

/** Median of a list — sorted middle, or the mean of the two middles. Empty → NaN. */
export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Theil–Sen slope (kg/week) over the trailing `days` window: the MEDIAN of every
 *  pairwise slope. Robust to outliers — a cheat-day spike, a creatine water-weight
 *  step, or a sick-week dip only moves a minority of the pairwise slopes, so the
 *  median holds where OLS would tilt the whole line and mis-read the trend. Same
 *  window + ≥5-reading guard as `regressionSlope`, so it's a drop-in for the weight
 *  trend. Returns null when the window can't support a trend. */
export function theilSenSlope(pts: { date: string; value: number }[], days = 28): number | null {
  const last = pts.at(-1)?.date;
  if (!last) return null;
  const cutoff = new Date(last + "T12:00:00");
  cutoff.setDate(cutoff.getDate() - days + 1);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const win = pts.filter((p) => p.date >= cutoffStr);
  if (win.length < 5) return null;
  const MS = 86400000;
  const t0 = new Date(win[0].date + "T12:00:00").getTime();
  const xs = win.map((p) => (new Date(p.date + "T12:00:00").getTime() - t0) / MS);
  const ys = win.map((p) => p.value);
  const slopes: number[] = [];
  for (let i = 0; i < win.length; i++) {
    for (let j = i + 1; j < win.length; j++) {
      const dx = xs[j] - xs[i];
      if (dx !== 0) slopes.push((ys[j] - ys[i]) / dx);
    }
  }
  if (!slopes.length) return null;
  return median(slopes) * 7; // kg/week
}

/** OLS fit over the trailing `days` window. Returns the slope (kg/week) AND the
 *  standard error of that slope (kg/week). The SE is what lets a caller ask
 *  whether a *difference* of two slopes clears the data's own scatter rather
 *  than a fixed deadband (see weightAcceleration). null when the window can't
 *  support a trend (<5 readings) or is degenerate (all readings on one day). */
function regressionFit(
  pts: { date: string; value: number }[],
  days: number,
): { slopePerWeek: number; sePerWeek: number } | null {
  const fit = olsFit(pts, days, 5);
  if (!fit) return null;
  return { slopePerWeek: fit.slopePerDay * 7, sePerWeek: fit.seSlopePerDay * 7 };
}

export function regressionSlope(pts: { date: string; value: number }[], days = 28): number | null {
  return regressionFit(pts, days)?.slopePerWeek ?? null;
}

// ─── Training-day vs rest-day active baselines ───────────────────────────────

/** Two typical active-energy values — one for days with a logged workout, one
 *  for days without — so a single day's reading is judged against the right
 *  kind of day instead of one blended average. Descriptive context only: no
 *  target semantics, no verdict, and deliberately no prediction of whether
 *  today WILL be a training day (the app only knows whether it already is). */
export interface DayTypeBaselines {
  /** Avg active kcal on days with ≥1 training log, rounded. */
  trainAvg: number;
  /** Avg active kcal on days with no training log, rounded. */
  restAvg: number;
  trainN: number;
  restN: number;
}

/** Baseline window — wider than the Energy card's 14-day display window on
 *  purpose: two split samples need more days to stay steady, and "typical
 *  training/rest day" is a trait, not a windowed stat of the visible bars. */
export const DAYTYPE_WINDOW_DAYS = 28;

export function computeDayTypeBaselines(
  metrics: BodyMetric[],
  trainingDates: ReadonlySet<string>,
  todayISO: string,
  windowDays = DAYTYPE_WINDOW_DAYS,
): DayTypeBaselines | null {
  const cutoff = new Date(`${todayISO}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffISO = localDateStr(cutoff);

  // Today is excluded from both baselines — its active reading is partial.
  let trainSum = 0, trainN = 0, restSum = 0, restN = 0;
  for (const m of metrics) {
    if (m.active_energy_kcal == null) continue;
    if (m.metric_date < cutoffISO || m.metric_date >= todayISO) continue;
    if (trainingDates.has(m.metric_date)) {
      trainSum += m.active_energy_kcal;
      trainN++;
    } else {
      restSum += m.active_energy_kcal;
      restN++;
    }
  }
  // Both baselines need a real sample to mean anything — a single-day "average"
  // reads as authoritative context but is noise.
  if (trainN < 2 || restN < 2) return null;
  return {
    trainAvg: Math.round(trainSum / trainN),
    restAvg: Math.round(restSum / restN),
    trainN,
    restN,
  };
}
