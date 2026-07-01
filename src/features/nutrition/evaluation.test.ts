import { describe, it, expect } from "vitest";
import { evaluate, type EvaluateInput } from "./evaluation";

const NOW = new Date("2026-07-01T08:00:00Z");

// A perfectly linear weight series (scatter 0) losing `kgPerWeek`, ending at a
// fixed anchor date so regressionSlope's trailing-window is deterministic.
function weightSeries(kgPerWeek: number, days = 21, start = 90, endDate = "2026-07-01") {
  const kgPerDay = kgPerWeek / 7;
  const end = new Date(endDate + "T12:00:00");
  const pts: { date: string; value: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(end);
    d.setDate(d.getDate() - (days - 1 - i));
    pts.push({ date: d.toISOString().slice(0, 10), value: start + kgPerDay * i });
  }
  return pts;
}

function input(over: Partial<EvaluateInput> & { weightSeries: EvaluateInput["weightSeries"] }): EvaluateInput {
  return {
    cutMode: "Moderate Cut",
    calorieTarget: 2145,
    estimatedTdee: 2800,
    daysOnTarget: 30,
    now: NOW,
    ...over,
  };
}

describe("evaluate — status vs cut-mode band", () => {
  it("flags below_target when losing slower than the Moderate band", () => {
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-0.1) }));
    expect(evaluation.status).toBe("below_target");
    expect(evaluation.observedRate).toBeLessThan(0); // negative = losing
  });

  it("is on_target inside the Moderate band", () => {
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-0.55) }));
    expect(evaluation.status).toBe("on_target");
    expect(evaluation.observedRate).toBeCloseTo(-0.55, 2);
  });

  it("flags above_target when losing faster than the band", () => {
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-1.0) }));
    expect(evaluation.status).toBe("above_target");
  });

  it("uses the Aggressive band when the cut mode is Aggressive", () => {
    // 0.5 kg/wk is on-target for Moderate but below the 0.6–0.9 Aggressive band.
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-0.5), cutMode: "Aggressive Cut" }));
    expect(evaluation.status).toBe("below_target");
    expect(evaluation.targetRange).toEqual({ min: 0.6, max: 0.9 });
  });
});

describe("evaluate — confidence", () => {
  it("is high with dense data, long time on target, and a clean trend", () => {
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-0.55) }));
    expect(evaluation.confidence).toBe("high");
  });

  it("is low with sparse weight data and little time on target", () => {
    const { evaluation } = evaluate(
      input({ weightSeries: weightSeries(-0.55, 6), daysOnTarget: 3 }),
    );
    expect(evaluation.confidence).toBe("low");
  });

  it("is low (neutral) when the trend can't be fit (too few points)", () => {
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-0.55, 4) }));
    expect(evaluation.confidence).toBe("low");
    expect(evaluation.status).toBe("on_target");
  });
});

describe("evaluate — unsupported cut mode", () => {
  it("returns a neutral low-confidence evaluation with no band", () => {
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-0.3), cutMode: "Cruise" }));
    expect(evaluation.status).toBe("on_target");
    expect(evaluation.confidence).toBe("low");
    expect(evaluation.targetRange).toEqual({ min: 0, max: 0 });
  });
});

describe("evaluate — diagnostics", () => {
  it("estimates intake from TDEE + the trend's energy balance", () => {
    // 2800 TDEE, losing 0.55 kg/wk → 2800 + (-0.55 * 7700 / 7) = 2195 kcal/day.
    const { diagnostics } = evaluate(input({ weightSeries: weightSeries(-0.55) }));
    expect(diagnostics.estimatedIntake).toBe(2195);
    expect(diagnostics.intakeDifference).toBe(2195 - 2145);
    expect(diagnostics.calorieTarget).toBe(2145);
    expect(diagnostics.cutMode).toBe("Moderate Cut");
  });
});
