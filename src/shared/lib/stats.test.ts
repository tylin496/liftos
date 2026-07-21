import { describe, it, expect } from "vitest";
import { olsFit } from "./stats";

// Consecutive daily readings starting 2026-01-01, one per value.
const daily = (values: number[], start = "2026-01-01") =>
  values.map((value, i) => {
    const d = new Date(start + "T12:00:00");
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().slice(0, 10), value };
  });

describe("olsFit", () => {
  it("recovers the slope of a perfectly linear series with ~zero SE", () => {
    const r = olsFit(daily([10, 12, 14, 16, 18]), 30, 5);
    expect(r).not.toBeNull();
    expect(r!.slopePerDay).toBeCloseTo(2, 9);
    expect(r!.seSlopePerDay).toBeCloseTo(0, 6);
  });

  it("recovers a negative slope (a downward trend)", () => {
    const r = olsFit(daily([100, 98, 96, 94, 92]), 30, 5);
    expect(r!.slopePerDay).toBeCloseTo(-2, 9);
  });

  it("returns null when the window has fewer than minPoints readings", () => {
    expect(olsFit(daily([1, 2, 3, 4]), 30, 5)).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(olsFit([], 30, 5)).toBeNull();
  });

  it("returns null when every reading is on the same day (degenerate x)", () => {
    const sameDay = [1, 2, 3, 4, 5].map((value) => ({ date: "2026-01-01", value }));
    expect(olsFit(sameDay, 30, 5)).toBeNull();
  });

  it("only fits readings inside the trailing `days` window", () => {
    // An old wild reading outside a 5-day window must not drag the slope.
    const pts = [
      { date: "2026-01-01", value: 0 }, // outside the window
      ...daily([100, 102, 104, 106, 108], "2026-01-06"),
    ];
    const r = olsFit(pts, 5, 5); // window = 2026-01-06 .. 2026-01-10
    expect(r!.slopePerDay).toBeCloseTo(2, 9);
  });

  it("reports a larger slope SE for a noisier series at the same trend", () => {
    const clean = olsFit(daily([10, 12, 14, 16, 18]), 30, 5)!;
    const noisy = olsFit(daily([10, 13, 13, 17, 18]), 30, 5)!;
    // Both trend up ~2/day, but the scattered one is less certain.
    expect(noisy.slopePerDay).toBeCloseTo(2, 1);
    expect(noisy.seSlopePerDay).toBeGreaterThan(clean.seSlopePerDay);
  });
});
