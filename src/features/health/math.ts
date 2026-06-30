import type { BodyMetric } from "./api";

export type MetricKey = "weight_kg" | "body_fat_pct" | "active_energy_kcal" | "resting_energy_kcal";

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
