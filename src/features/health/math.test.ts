import { describe, it, expect } from "vitest";
import { series, bucketSeries, rollingAvg, regressionSlope } from "./math";
import type { BodyMetric } from "./api";

// Helper: build a sequential daily series from a start date.
function daily(start: string, values: number[]): { date: string; value: number }[] {
  const MS = 86400000;
  const t0 = new Date(start + "T12:00:00").getTime();
  return values.map((value, i) => ({
    date: new Date(t0 + i * MS).toISOString().slice(0, 10),
    value,
  }));
}

describe("series", () => {
  it("extracts a metric and drops null readings", () => {
    const metrics = [
      { metric_date: "2026-01-01", weight_kg: 90, body_fat_pct: null },
      { metric_date: "2026-01-02", weight_kg: null, body_fat_pct: 20 },
      { metric_date: "2026-01-03", weight_kg: 89.5, body_fat_pct: 19 },
    ] as unknown as BodyMetric[];

    expect(series(metrics, "weight_kg")).toEqual([
      { date: "2026-01-01", value: 90 },
      { date: "2026-01-03", value: 89.5 },
    ]);
  });
});

describe("bucketSeries", () => {
  it("returns [] for empty input (no divide-by-zero)", () => {
    expect(bucketSeries([], { spanDays: 180, bucketDays: 7 })).toEqual([]);
  });

  it("returns exactly one point for a single reading", () => {
    const pts = [{ date: "2026-06-30", value: 92.3 }];
    const out = bucketSeries(pts, { spanDays: 180, bucketDays: 7 });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      date: "2026-06-30",
      dateStart: "2026-06-30",
      dateEnd: "2026-06-30",
      value: 92.3,
    });
  });

  it("passes points through unbucketed when bucketDays <= 1", () => {
    const pts = daily("2026-06-28", [1, 2, 3]);
    const out = bucketSeries(pts, { spanDays: 180, bucketDays: 1 });
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.value)).toEqual([1, 2, 3]);
    expect(out[0]).toMatchObject({ dateStart: "2026-06-28", dateEnd: "2026-06-28" });
  });

  it("averages each bucket and orders oldest -> newest, anchored on latest reading", () => {
    // 14 daily points; bucketDays=7 -> two 7-day buckets stepping back from the anchor.
    const pts = daily("2026-06-17", [
      // older week: 10..16 (avg 13)
      10, 11, 12, 13, 14, 15, 16,
      // newer week: 20..26 (avg 23)
      20, 21, 22, 23, 24, 25, 26,
    ]);
    const out = bucketSeries(pts, { spanDays: 180, bucketDays: 7 });
    expect(out).toHaveLength(2);
    // oldest first (left), newest last (right)
    expect(out[0].value).toBeCloseTo(13, 10);
    expect(out[1].value).toBeCloseTo(23, 10);
    // newest bucket spans the latest 7 days, ending on the anchor
    expect(out[1].dateEnd).toBe("2026-06-30");
    expect(out[1].dateStart).toBe("2026-06-24");
  });

  it("drops points outside the visible span window", () => {
    // One point 200 days before the anchor must fall outside a 180-day span.
    const pts = [
      { date: "2025-12-01", value: 100 }, // far in the past
      { date: "2026-06-29", value: 50 },
      { date: "2026-06-30", value: 52 },
    ];
    const out = bucketSeries(pts, { spanDays: 180, bucketDays: 7 });
    // only the two recent points survive, in one bucket
    expect(out).toHaveLength(1);
    expect(out[0].value).toBeCloseTo(51, 10);
  });
});

describe("rollingAvg", () => {
  it("returns null for empty input", () => {
    expect(rollingAvg([], 7, 0)).toBeNull();
  });

  it("averages the trailing window anchored on the last reading", () => {
    const pts = daily("2026-06-24", [80, 82, 84, 86, 88, 90, 92]); // 7 days
    // last 7 days = all of them, avg = 86
    expect(rollingAvg(pts, 7, 0)).toBeCloseTo(86, 10);
  });

  it("handles sparse data within the window", () => {
    // Only two readings inside the last 7 days (offset 0).
    const pts = [
      { date: "2026-06-25", value: 100 },
      { date: "2026-06-30", value: 110 },
    ];
    expect(rollingAvg(pts, 7, 0)).toBeCloseTo(105, 10);
  });

  it("returns null when the offset window contains no readings", () => {
    const pts = [
      { date: "2026-06-29", value: 100 },
      { date: "2026-06-30", value: 110 },
    ];
    // shift back 14 days -> nothing in that window
    expect(rollingAvg(pts, 7, 14)).toBeNull();
  });

  it("offset selects the previous period for comparison", () => {
    const pts = daily("2026-06-17", [
      1, 1, 1, 1, 1, 1, 1, // prev week avg 1
      9, 9, 9, 9, 9, 9, 9, // this week avg 9
    ]);
    expect(rollingAvg(pts, 7, 0)).toBeCloseTo(9, 10);
    expect(rollingAvg(pts, 7, 7)).toBeCloseTo(1, 10);
  });
});

describe("regressionSlope", () => {
  it("returns null for empty input", () => {
    expect(regressionSlope([], 28)).toBeNull();
  });

  it("returns null below the 5-point minimum", () => {
    const pts = daily("2026-06-27", [1, 2, 3, 4]); // only 4 points
    expect(regressionSlope(pts, 28)).toBeNull();
  });

  it("computes a slope at exactly the 5-point boundary", () => {
    // y increases by 2 per day -> slope 2/day -> 14 per week.
    const pts = daily("2026-06-26", [10, 12, 14, 16, 18]); // 5 points
    expect(regressionSlope(pts, 28)).toBeCloseTo(14, 6);
  });

  it("reports a clear positive slope in units/week", () => {
    // +1 per day over a week -> 7 per week.
    const pts = daily("2026-06-24", [70, 71, 72, 73, 74, 75, 76]);
    expect(regressionSlope(pts, 28)).toBeCloseTo(7, 6);
  });

  it("reports a clear negative slope", () => {
    // -0.5 per day -> -3.5 per week.
    const pts = daily("2026-06-24", [90, 89.5, 89, 88.5, 88, 87.5, 87]);
    expect(regressionSlope(pts, 28)).toBeCloseTo(-3.5, 6);
  });

  it("returns 0 for a perfectly flat series with enough points", () => {
    const pts = daily("2026-06-26", [50, 50, 50, 50, 50]);
    expect(regressionSlope(pts, 28)).toBeCloseTo(0, 10);
  });

  it("ignores points older than the regression window", () => {
    // Old steep data should be excluded by the 28-day cutoff; recent flat
    // data should win, producing ~0 slope.
    const old = daily("2026-01-01", [1, 100, 200, 300, 400]);
    const recent = daily("2026-06-26", [50, 50, 50, 50, 50]);
    const slope = regressionSlope([...old, ...recent], 28);
    expect(slope).toBeCloseTo(0, 10);
  });
});
