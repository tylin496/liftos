import { describe, it, expect } from "vitest";
import { buildLeanMassEvaluation } from "./goal";
import type { BodyMetric } from "@features/health/api";

// Only the three fields buildLeanMassEvaluation reads.
const row = (metric_date: string, weight_kg: number, body_fat_pct: number) =>
  ({ metric_date, weight_kg, body_fat_pct }) as unknown as BodyMetric;

/** `days` daily readings ending at `endDate`, lean = leanStart + slopePerDay·i + noise[i].
 *  Body fat fixed at 20% so lean = weight × 0.8 (weight = lean / 0.8). */
function leanSeries(
  days: number,
  endDate: string,
  leanStart: number,
  slopePerDay: number,
  noise: number[] = [],
): BodyMetric[] {
  const out: BodyMetric[] = [];
  const end = new Date(endDate + "T12:00:00");
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - (days - 1 - i));
    const lean = leanStart + slopePerDay * i + (noise[i] ?? 0);
    out.push(row(d.toISOString().slice(0, 10), lean / 0.8, 20));
  }
  return out;
}

const zig = (n: number, amp: number) => Array.from({ length: n }, (_, i) => (i % 2 ? amp : -amp));

describe("buildLeanMassEvaluation — noise-aware (SE-gated)", () => {
  it("a clean, steep decline reads as falling / high", () => {
    // lean 70 → 68 over 60 days = −1.0 kg/month, no noise
    const ev = buildLeanMassEvaluation(leanSeries(60, "2026-07-06", 70, -2 / 60));
    expect(ev.trend).toBe("falling");
    expect(ev.confidence).toBe("high");
  });

  it("a noisy-but-flat trend does NOT fire (the real-data failure mode)", () => {
    const ev = buildLeanMassEvaluation(leanSeries(60, "2026-07-06", 69, 0, zig(60, 1.9)));
    expect(ev.trend).toBe("stable");
    expect(ev.confidence).toBe("low");
  });

  it("a real downslope still buried in noise does NOT fire (fails the SE gate)", () => {
    // true −0.7 kg/month, but ±3 kg scatter makes it indistinguishable from flat
    const ev = buildLeanMassEvaluation(leanSeries(60, "2026-07-06", 69, -0.7 / 30, zig(60, 3)));
    expect(ev.trend).toBe("stable");
  });

  it("too few readings → stable / low (never fires on sparse data)", () => {
    const ev = buildLeanMassEvaluation(leanSeries(5, "2026-07-06", 70, -2 / 60));
    expect(ev.confidence).toBe("low");
  });
});
