import type { BodyMetric } from "./api";

export type MetricKey =
  | "weight_kg"
  | "body_fat_pct"
  | "active_energy_kcal"
  | "resting_energy_kcal"
  | "steps"
  | "exercise_minutes"
  | "sleep_seconds"
  | "resting_heart_rate"
  | "hrv_sdnn_ms";

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
  Fair:               "var(--gold)",
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

  // Insight: a short, plain-language read of where the user's 7-day averages sit
  // against their 30-day baseline. When a marker is off we name it; when
  // everything's holding we surface the strongest one. Descriptive, not
  // prescriptive — the read reflects the state, it never tells the user what to do.
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
  else if (downCount >= 2) insight = `Several markers are running under your 30-day baseline — ${read}.`;
  else if (sleepLow) insight = `Sleep 7-day average is running below your 30-day baseline — ${read}.`;
  else if (hrvLow) insight = `HRV 7-day average is running below your 30-day baseline — ${read}.`;
  else if (rhrHigh) insight = `Resting HR 7-day average is running above your 30-day baseline — ${read}.`;
  else if (above.length) insight = `${above[0].label} 7-day average is running ${above[0].dir} your 30-day baseline — ${read}.`;
  else insight = `You're holding steady at your 30-day baseline — ${read}.`;

  const dates = [sleepPts.at(-1)?.date, hrvPts.at(-1)?.date, rhrPts.at(-1)?.date]
    .filter((d): d is string => d != null);
  const date = dates.length ? dates.sort().at(-1)! : null;

  return { sleepHours, hrv, rhr, sleepBaseline, hrvBaseline, rhrBaseline, score, status, insight, date };
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
