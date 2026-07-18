import { describe, it, expect } from "vitest";
import { series, bucketSeries, rollingAvg, rollingBand, regressionSlope, theilSenSlope, median, weightAcceleration, computeRecovery } from "./math";
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

  it("uses calendar days, not the last N available samples", () => {
    const pts = [
      { date: "2026-05-01", value: 1 },
      { date: "2026-05-15", value: 1 },
      { date: "2026-05-31", value: 1 },
      { date: "2026-06-01", value: 100 },
      { date: "2026-06-15", value: 110 },
      { date: "2026-06-30", value: 200 },
    ];

    // Latest is 2026-06-30, so offset 1 anchors the window on 2026-06-29.
    // The 30 calendar-day window is 2026-05-31..2026-06-29 inclusive.
    expect(rollingAvg(pts, 30, 1)).toBeCloseTo((1 + 100 + 110) / 3, 10);
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

describe("rollingBand", () => {
  it("returns mean ± 1 SD over the trailing window", () => {
    // 6 alternating readings: mean 90, population SD 10
    const pts = daily("2026-06-24", [80, 100, 80, 100, 80, 100, 50]);
    // offset 1 excludes the final 50 — the band describes the window before it
    const band = rollingBand(pts, 30, 1)!;
    expect(band.lo).toBeCloseTo(80, 10);
    expect(band.hi).toBeCloseTo(100, 10);
  });

  it("returns null under the minimum reading count", () => {
    const pts = daily("2026-06-27", [80, 100, 80, 100, 50]); // 4 in window after offset
    expect(rollingBand(pts, 30, 1)).toBeNull();
  });
});

describe("computeRecovery", () => {
  // Baseline = 30-day average *before* the latest reading. So each fixture is
  // 30 flat baseline days followed by one final day we vary. Baselines:
  // sleep 7h (25200s), HRV 60ms, RHR 55bpm. The latest day is judged "off" by
  // the same ±5% threshold computeRecovery uses (sleep/HRV low, RHR high).
  const BASE = { sleep_seconds: 25200, hrv_sdnn_ms: 60, resting_heart_rate: 55 };

  function recoveryMetrics(final: Partial<typeof BASE>): BodyMetric[] {
    const MS = 86400000;
    const t0 = new Date("2026-06-01T12:00:00").getTime();
    const days: BodyMetric[] = [];
    for (let i = 0; i < 30; i++) {
      days.push({
        metric_date: new Date(t0 + i * MS).toISOString().slice(0, 10),
        ...BASE,
      } as unknown as BodyMetric);
    }
    days.push({
      metric_date: new Date(t0 + 30 * MS).toISOString().slice(0, 10),
      ...BASE,
      ...final,
    } as unknown as BodyMetric);
    return days;
  }

  function setLastDays(metrics: BodyMetric[], count: number, patch: Partial<typeof BASE>): BodyMetric[] {
    return metrics.map((m, i) =>
      i >= metrics.length - count ? ({ ...m, ...patch } as BodyMetric) : m,
    );
  }

  it("0 signals off -> Ready, holding-steady read", () => {
    const snap = computeRecovery(recoveryMetrics({}));
    expect(snap.score).toBe(3);
    expect(snap.status).toBe("Ready");
    expect(snap.insight).toBe("Your 7-day averages are holding steady against baseline — recovery looks solid");
  });

  it("sleep only off -> Good, names sleep", () => {
    const snap = computeRecovery(setLastDays(recoveryMetrics({}), 7, { sleep_seconds: 21600 })); // 6h < 6.65h
    expect(snap.score).toBe(2);
    expect(snap.status).toBe("Good");
    expect(snap.insight).toBe("Sleep 7-day average is running below baseline — recovery's holding up");
  });

  it("excludes obvious incomplete sleep records from the sleep baseline", () => {
    const metrics = recoveryMetrics({});
    metrics[0] = { ...metrics[0], sleep_seconds: 7200 } as BodyMetric;

    const snap = computeRecovery(metrics);
    expect(snap.sleepBaseline).toBeCloseTo(7, 10);
  });

  it("uses the valid 7-day sleep average as the current sleep value", () => {
    const metrics = setLastDays(recoveryMetrics({}), 7, { sleep_seconds: 21600 });
    metrics[metrics.length - 1] = { ...metrics[metrics.length - 1], sleep_seconds: 7200 } as BodyMetric;

    const snap = computeRecovery(metrics);
    expect(snap.sleepHours).toBeCloseTo((6 * 6 + 7) / 7, 10);
  });

  it("uses available days when fewer than 7 readings exist in the current window", () => {
    const metrics = recoveryMetrics({});
    metrics[metrics.length - 1] = {
      ...metrics[metrics.length - 1],
      sleep_seconds: 28800,
      hrv_sdnn_ms: 70,
      resting_heart_rate: 50,
    } as BodyMetric;
    const snap = computeRecovery(metrics.filter((_m, i) => i < metrics.length - 7 || i === metrics.length - 1));
    expect(snap.sleepHours).toBeCloseTo(8, 10);
    expect(snap.hrv).toBeCloseTo(70, 10);
    expect(snap.rhr).toBeCloseTo(50, 10);
  });

  it("HRV only off -> Good, names HRV", () => {
    const snap = computeRecovery(setLastDays(recoveryMetrics({}), 7, { hrv_sdnn_ms: 55 })); // < 57
    expect(snap.score).toBe(2);
    expect(snap.status).toBe("Good");
    expect(snap.hrv).toBeCloseTo(55, 10);
    expect(snap.insight).toBe("HRV 7-day average is running below baseline — recovery's holding up");
  });

  it("RHR only off -> Good, names resting heart rate", () => {
    const snap = computeRecovery(setLastDays(recoveryMetrics({}), 7, { resting_heart_rate: 60 })); // > 57.75
    expect(snap.score).toBe(2);
    expect(snap.status).toBe("Good");
    expect(snap.rhr).toBeCloseTo(60, 10);
    expect(snap.insight).toBe("Resting HR 7-day average is running above baseline — recovery's holding up");
  });

  it("two signals off -> Fair, aggregate insight (no single metric named)", () => {
    const snap = computeRecovery(setLastDays(recoveryMetrics({}), 7, { sleep_seconds: 21600, hrv_sdnn_ms: 55 }));
    expect(snap.score).toBe(1);
    expect(snap.status).toBe("Fair");
    expect(snap.insight).toBe("Several 7-day averages are running below baseline — recovery's a little down");
  });

  it("all three off -> Needs Recovery, aggregate insight", () => {
    const snap = computeRecovery(
      setLastDays(recoveryMetrics({}), 7, { sleep_seconds: 21600, hrv_sdnn_ms: 55, resting_heart_rate: 60 }),
    );
    expect(snap.score).toBe(0);
    expect(snap.status).toBe("Needs Recovery");
    expect(snap.insight).toBe("Several 7-day averages are running below baseline — recovery's running low");
  });

  it("a marker with a value but no baseline reads neutral, not a miss (partial baseline)", () => {
    // Sleep has a full 30-day baseline and sits on it; HRV and RHR appear ONLY on
    // the final day, so neither can be graded. The ungradeable markers must read
    // neutral (like their gauges) — scoring them as misses dropped a perfect
    // sleep to a false "Fair" against two neutral gauges.
    const MS = 86400000;
    const t0 = new Date("2026-06-01T12:00:00").getTime();
    const days: BodyMetric[] = [];
    for (let i = 0; i < 30; i++) {
      days.push({
        metric_date: new Date(t0 + i * MS).toISOString().slice(0, 10),
        sleep_seconds: 25200,
      } as unknown as BodyMetric);
    }
    days.push({
      metric_date: new Date(t0 + 30 * MS).toISOString().slice(0, 10),
      sleep_seconds: 25200,
      hrv_sdnn_ms: 60,
      resting_heart_rate: 55,
    } as unknown as BodyMetric);
    const snap = computeRecovery(days);
    expect(snap.hrvBaseline).toBeNull();
    expect(snap.rhrBaseline).toBeNull();
    expect(snap.baselineBuilding).toBe(false); // sleep IS gradeable → normal verdict
    expect(snap.score).toBe(3);
    expect(snap.status).toBe("Ready");
  });

  // exercise_minutes attributes a low reading to its likely cause (loadContext).
  function withExercise(metrics: BodyMetric[], count: number, minutes: number): BodyMetric[] {
    return metrics.map((m, i) =>
      i >= metrics.length - count ? ({ ...m, exercise_minutes: minutes } as BodyMetric) : m,
    );
  }

  it("low readiness after real training -> loadContext training-stress, names it", () => {
    const base = setLastDays(recoveryMetrics({}), 7, { sleep_seconds: 21600, hrv_sdnn_ms: 55 }); // Fair
    const snap = computeRecovery(withExercise(base, 7, 60));
    expect(snap.status).toBe("Fair");
    expect(snap.loadContext).toBe("training-stress");
    expect(snap.insight).toBe(
      "Several 7-day averages are running below baseline — recovery's a little down; likely training fatigue after recent hard sessions",
    );
  });

  it("low readiness with little training -> loadContext systemic", () => {
    const base = setLastDays(recoveryMetrics({}), 7, { sleep_seconds: 21600, hrv_sdnn_ms: 55 });
    const snap = computeRecovery(withExercise(base, 7, 5));
    expect(snap.loadContext).toBe("systemic");
    expect(snap.insight).toContain("more likely sleep or life stress");
  });

  it("high readiness -> loadContext null even with training data present", () => {
    const snap = computeRecovery(withExercise(recoveryMetrics({}), 7, 60)); // Ready
    expect(snap.status).toBe("Ready");
    expect(snap.loadContext).toBeNull();
  });

  it("low readiness but no exercise data -> loadContext null (can't attribute)", () => {
    const snap = computeRecovery(setLastDays(recoveryMetrics({}), 7, { sleep_seconds: 21600, hrv_sdnn_ms: 55 }));
    expect(snap.status).toBe("Fair");
    expect(snap.loadContext).toBeNull();
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

describe("median", () => {
  it("returns the middle of an odd-length list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it("averages the two middles of an even-length list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("returns NaN for an empty list", () => {
    expect(median([])).toBeNaN();
  });
});

describe("theilSenSlope", () => {
  it("matches OLS on clean linear data", () => {
    const pts = daily("2026-06-24", [70, 71, 72, 73, 74, 75, 76]); // +1/day → 7/wk
    expect(theilSenSlope(pts, 28)).toBeCloseTo(7, 6);
    expect(theilSenSlope(pts, 28)).toBeCloseTo(regressionSlope(pts, 28)!, 6);
  });

  it("shares regressionSlope's guards (empty → null, <5 pts → null)", () => {
    expect(theilSenSlope([], 28)).toBeNull();
    expect(theilSenSlope(daily("2026-06-27", [1, 2, 3, 4]), 28)).toBeNull();
  });

  it("returns 0 for a flat series", () => {
    expect(theilSenSlope(daily("2026-06-26", [50, 50, 50, 50, 50]), 28)).toBeCloseTo(0, 10);
  });

  it("is unmoved by a single outlier that badly tilts OLS (the #1 case)", () => {
    // 14 days losing 0.1 kg/day (−0.7 kg/wk), then a +2 kg cheat/water spike near
    // the end — a classic contaminant. OLS tilts to −0.36 (would misread the cut
    // as stalling); the median-of-pairwise-slopes stays put.
    const clean = Array.from({ length: 14 }, (_, i) => +(90 - 0.1 * i).toFixed(2));
    const contaminated = [...clean];
    contaminated[12] = +(clean[12] + 2).toFixed(2);
    const cs = daily("2026-06-15", clean);
    const ct = daily("2026-06-15", contaminated);

    expect(theilSenSlope(cs, 28)).toBeCloseTo(-0.7, 6);
    expect(theilSenSlope(ct, 28)).toBeCloseTo(-0.7, 6); // outlier ignored
    expect(regressionSlope(ct, 28)).toBeCloseTo(-0.36, 1); // OLS badly tilted
    // Theil–Sen is far less perturbed than OLS.
    expect(Math.abs(theilSenSlope(ct, 28)! + 0.7)).toBeLessThan(
      Math.abs(regressionSlope(ct, 28)! + 0.7),
    );
  });
});

describe("weightAcceleration", () => {
  // 28 consecutive daily readings: the first 14 fall in the "prior" window, the
  // last 14 in the "recent" window, each an exactly-linear ramp so its slope is
  // known. priorPerDay/recentPerDay are the per-day steps (×7 = kg/week).
  function twoRate(priorPerDay: number, recentPerDay: number, start = 90) {
    const vals: number[] = [];
    let v = start;
    for (let i = 0; i < 14; i++) { vals.push(v); v += priorPerDay; }
    for (let i = 0; i < 14; i++) { vals.push(v); v += recentPerDay; }
    return daily("2026-06-01", vals);
  }

  it("flags strong slowing when the loss decelerates (prior −0.7 → recent −0.28)", () => {
    const a = weightAcceleration(twoRate(-0.1, -0.04));
    expect(a?.direction).toBe("slowing");
    expect(a?.strong).toBe(true);
    expect(a?.deltaPerWeek).toBeCloseTo(0.42, 2);
  });

  it("flags mild slowing between the steady and strong thresholds", () => {
    const a = weightAcceleration(twoRate(-0.1, -0.08)); // Δ ≈ +0.14 kg/wk
    expect(a?.direction).toBe("slowing");
    expect(a?.strong).toBe(false);
  });

  it("flags faster (neutral) when the loss accelerates", () => {
    const a = weightAcceleration(twoRate(-0.04, -0.1));
    expect(a?.direction).toBe("faster");
    expect(a?.deltaPerWeek).toBeCloseTo(-0.42, 2);
  });

  it("returns null inside the steady deadband (Δ < 0.1 kg/wk)", () => {
    expect(weightAcceleration(twoRate(-0.1, -0.11))).toBeNull(); // Δ ≈ −0.07
  });

  it("stays silent when the delta is smaller than the windows' own scatter", () => {
    // Same underlying slopes as a mild-slowing read (Δ ≈ +0.15 kg/wk, above the
    // 0.1 floor), but each reading carries ±0.3 kg of daily scatter. The combined
    // standard error of the two slopes now exceeds the delta, so a fixed deadband
    // would flag "slowing" on noise while the SE gate correctly stays mute.
    const noisy = (priorPerDay: number, recentPerDay: number) => {
      const vals: number[] = [];
      let v = 90;
      for (let i = 0; i < 14; i++) { vals.push(v + (i % 2 ? 0.3 : -0.3)); v += priorPerDay; }
      for (let i = 0; i < 14; i++) { vals.push(v + (i % 2 ? 0.3 : -0.3)); v += recentPerDay; }
      return daily("2026-06-01", vals);
    };
    // Noise-free, the same slopes DO fire (delta clears the 0.1 floor)…
    expect(weightAcceleration(twoRate(-0.1, -0.079))?.direction).toBe("slowing");
    // …but with the scatter added, the delta is inside the error bar → null.
    expect(weightAcceleration(noisy(-0.1, -0.079))).toBeNull();
  });

  it("returns null when the prior window wasn't a loss regime", () => {
    expect(weightAcceleration(twoRate(0.05, -0.02))).toBeNull(); // prior gaining
  });

  it("mirrors under a bulk direction (+1): gain decelerating reads 'slowing'", () => {
    // Prior +0.7 kg/wk of gain → recent +0.28: the GAIN is slowing.
    const a = weightAcceleration(twoRate(0.1, 0.04), 1);
    expect(a?.direction).toBe("slowing");
    // And a gain speeding up reads 'faster'.
    expect(weightAcceleration(twoRate(0.04, 0.1), 1)?.direction).toBe("faster");
    // A prior LOSS regime is not established gain — silent under +1.
    expect(weightAcceleration(twoRate(-0.1, 0.05), 1)).toBeNull();
  });

  it("returns null when a window can't fit a trend", () => {
    // 8 days: the prior window (≤ last−14) is empty, so there's nothing to
    // compare against.
    expect(weightAcceleration(daily("2026-06-20", [90, 89.9, 89.8, 89.7, 89.6, 89.5, 89.4, 89.3]))).toBeNull();
  });
});

// ─── computeDayTypeBaselines ─────────────────────────────────────────────────

import { computeDayTypeBaselines } from "./math";

const am = (date: string, kcal: number | null): BodyMetric =>
  ({ metric_date: date, active_energy_kcal: kcal }) as BodyMetric;

describe("computeDayTypeBaselines", () => {
  const TODAY = "2026-07-18";

  it("splits the window's days by whether they were trained", () => {
    const metrics = [
      am("2026-07-14", 700), // trained
      am("2026-07-15", 300),
      am("2026-07-16", 600), // trained
      am("2026-07-17", 340),
    ];
    const trained = new Set(["2026-07-14", "2026-07-16"]);
    expect(computeDayTypeBaselines(metrics, trained, TODAY)).toEqual({
      trainAvg: 650,
      restAvg: 320,
      trainN: 2,
      restN: 2,
    });
  });

  it("excludes today's partial reading and days outside the window", () => {
    const metrics = [
      am("2026-06-01", 9999), // before the 28-day window
      am("2026-07-14", 700),
      am("2026-07-16", 600),
      am("2026-07-15", 300),
      am("2026-07-17", 340),
      am(TODAY, 50), // partial — never in a baseline
    ];
    const trained = new Set(["2026-06-01", "2026-07-14", "2026-07-16", TODAY]);
    const out = computeDayTypeBaselines(metrics, trained, TODAY);
    expect(out?.trainAvg).toBe(650);
    expect(out?.restAvg).toBe(320);
  });

  it("returns null until both day types have ≥2 samples", () => {
    const metrics = [
      am("2026-07-14", 700),
      am("2026-07-16", 600),
      am("2026-07-17", 340), // only one rest day
    ];
    const trained = new Set(["2026-07-14", "2026-07-16"]);
    expect(computeDayTypeBaselines(metrics, trained, TODAY)).toBeNull();
  });

  it("ignores days with no active reading", () => {
    const metrics = [
      am("2026-07-13", null), // synced but no active field
      am("2026-07-14", 700),
      am("2026-07-15", 300),
      am("2026-07-16", 600),
      am("2026-07-17", 340),
    ];
    const trained = new Set(["2026-07-13", "2026-07-14", "2026-07-16"]);
    const out = computeDayTypeBaselines(metrics, trained, TODAY);
    expect(out?.trainN).toBe(2);
    expect(out?.restN).toBe(2);
  });
});
