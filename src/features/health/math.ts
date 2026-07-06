import type { BodyMetric } from "./api";
import { localDateStr } from "@shared/lib/date";

// Sync freshness for the header note. Shared by both the Health tab (freshness of
// the metrics every card anchors on) and Overview (freshness of the topbar
// activity ring, which only accrues as fast as the health sync). With multiple
// sync methods now (scheduled runs, on-open), today shows the actual clock time
// of the last write so you can tell how fresh it is; yesterday reads plainly;
// two-plus days is a real staleness problem, so it flags bad.
export function syncLabel(
  latest: Pick<BodyMetric, "metric_date" | "updated_at"> | null,
): { text: string; tone: "normal" | "bad" } | null {
  if (!latest) return null;
  const daysAgo = Math.round((Date.parse(localDateStr()) - Date.parse(latest.metric_date)) / 86400000);
  if (daysAgo <= 0) {
    const t = new Date(latest.updated_at);
    if (!Number.isNaN(t.getTime())) {
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      return { text: `Synced ${hh}:${mm}`, tone: "normal" };
    }
    return { text: "Synced today", tone: "normal" };
  }
  if (daysAgo === 1) return { text: "Synced yesterday", tone: "normal" };
  return { text: `Synced ${daysAgo} days ago`, tone: "bad" };
}

/** Just the clock time (HH:MM) of the latest sync, and only when it landed
 *  today — older readings carry no meaningful time-of-day, so this returns null
 *  and the caller shows nothing (staleness is surfaced elsewhere). */
export function syncTime(
  latest: Pick<BodyMetric, "metric_date" | "updated_at"> | null,
): string | null {
  if (!latest) return null;
  const daysAgo = Math.round((Date.parse(localDateStr()) - Date.parse(latest.metric_date)) / 86400000);
  if (daysAgo > 0) return null;
  const t = new Date(latest.updated_at);
  if (Number.isNaN(t.getTime())) return null;
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

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

export function isImplausibleBodyFat(pct: number): boolean {
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

export function rollingAvg(pts: { date: string; value: number }[], days = 7, offsetDays = 0): number | null {
  if (!pts.length) return null;
  const last = pts.at(-1)!.date;
  const end = new Date(last + "T12:00:00");
  end.setDate(end.getDate() - offsetDays);
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  const endStr = end.toISOString().slice(0, 10);
  const startStr = start.toISOString().slice(0, 10);
  const window = pts.filter((p) => p.date >= startStr && p.date <= endStr);
  if (!window.length) return null;
  return window.reduce((s, p) => s + p.value, 0) / window.length;
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
  /** 0–3: how many metrics are at or above their personal baseline */
  score: number;
  status: RecoveryStatus | null;
  /** one-line, informational read on recent recovery vs. baseline */
  insight: string | null;
  /** date string of the most recent reading used */
  date: string | null;
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

  let score = 0;
  if (sleepHours != null && sleepBaseline != null && sleepHours >= sleepBaseline * 0.95) score++;
  if (hrv != null && hrvBaseline != null && hrv >= hrvBaseline * 0.95) score++;
  if (rhr != null && rhrBaseline != null && rhr <= rhrBaseline * 1.05) score++;

  const hasAny = sleepHours != null || hrv != null || rhr != null;
  const status: RecoveryStatus | null = !hasAny ? null
    : score === 3 ? "Ready"
    : score === 2 ? "Good"
    : score === 1 ? "Fair"
    : "Needs Recovery";

  // Insight: a short, plain-language read of where the user's 7-day averages sit.
  // When a marker is off we name it; when everything's holding we surface the
  // strongest one. Descriptive, not prescriptive — the read reflects the state,
  // it never tells the user what to do.
  const sleepLow = sleepHours != null && sleepBaseline != null && sleepHours < sleepBaseline * 0.95;
  const hrvLow   = hrv != null && hrvBaseline != null && hrv < hrvBaseline * 0.95;
  const rhrHigh  = rhr != null && rhrBaseline != null && rhr > rhrBaseline * 1.05;
  const downCount = (sleepLow ? 1 : 0) + (hrvLow ? 1 : 0) + (rhrHigh ? 1 : 0);

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

  const dates = [sleepPts.at(-1)?.date, hrvPts.at(-1)?.date, rhrPts.at(-1)?.date]
    .filter((d): d is string => d != null);
  const date = dates.length ? dates.sort().at(-1)! : null;

  return { sleepHours, hrv, rhr, sleepBaseline, hrvBaseline, rhrBaseline, score, status, insight, date };
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
export function recentTrainingLoad(metrics: BodyMetric[]): "trained" | "rested" | null {
  if (!metrics.length) return null;
  const pts = series(metrics, "exercise_minutes");
  if (!pts.length) return null;
  const anchor = new Date(metrics.at(-1)!.metric_date + "T12:00:00").getTime();
  const cutoff = anchor - 6 * 86400000; // trailing 7 days, inclusive of the anchor
  const week = pts.filter((p) => new Date(p.date + "T12:00:00").getTime() >= cutoff);
  const trainedDays = week.filter((p) => p.value >= TRAINED_MINUTES).length;
  return trainedDays >= TRAINED_DAYS ? "trained" : "rested";
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
  return { status: rec.status, score: rec.score, trainingLoad: recentTrainingLoad(metrics) };
}

export function regressionSlope(pts: { date: string; value: number }[], days = 28): number | null {
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
  const n = win.length;
  const sumX = xs.reduce((s, x) => s + x, 0);
  const sumY = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (!denom) return null;
  return ((n * sumXY - sumX * sumY) / denom) * 7; // kg/week
}
