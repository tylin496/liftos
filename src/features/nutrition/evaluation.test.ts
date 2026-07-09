import { describe, it, expect } from "vitest";
import { evaluate, tdeeCalibration, type EvaluateInput } from "./evaluation";

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

// The same linear trend as weightSeries, but keeping only the readings on the
// given day-offsets from the window start (0 = oldest, days-1 = endDate). Lets
// us vary the *distribution* of readings (holes vs even spread) while holding
// the count and the fit fixed.
function sampledSeries(kgPerWeek: number, keepOffsets: number[], days = 21) {
  const full = weightSeries(kgPerWeek, days);
  return keepOffsets.map((i) => full[i]);
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

  // Distribution matters, not just count: two 8-point series with the identical
  // clean trend and time on target — one evenly spread, one split by a 14-day
  // hole — must not score the same. The hole is a lever-arm fit, so it caps.
  it("caps confidence when readings straddle a large interior gap", () => {
    const holed = evaluate(
      input({ weightSeries: sampledSeries(-0.55, [0, 1, 2, 3, 17, 18, 19, 20]) }),
    );
    expect(holed.diagnostics.longestGap).toBe(14);
    expect(holed.evaluation.confidence).toBe("medium"); // was high before the gap cap
  });

  it("keeps confidence high when the same count is evenly spread", () => {
    const spread = evaluate(
      input({ weightSeries: sampledSeries(-0.55, [0, 3, 6, 9, 12, 15, 18, 20]) }),
    );
    expect(spread.diagnostics.longestGap).toBe(3);
    expect(spread.evaluation.confidence).toBe("high");
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

  it("echoes daysOnTarget so surfaces can explain the confidence", () => {
    const { diagnostics } = evaluate(input({ weightSeries: weightSeries(-0.55), daysOnTarget: 5 }));
    expect(diagnostics.daysOnTarget).toBe(5);
  });
});

describe("evaluate — fresh-target confidence cap", () => {
  // Same clean, dense, in-band series (would score "high" on data alone); only
  // the target tenure differs.
  it("caps a fresh target (held < 14 days) at medium, however clean the data", () => {
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-0.55), daysOnTarget: 10 }));
    expect(evaluation.confidence).toBe("medium");
  });

  it("allows high once the target has been held ≥ 14 days", () => {
    const { evaluation } = evaluate(input({ weightSeries: weightSeries(-0.55), daysOnTarget: 30 }));
    expect(evaluation.confidence).toBe("high");
  });
});

describe("evaluate — food-log divergence confidence cap", () => {
  // Same clean, dense, ≥14-day series that scores "high" on its own (estimated
  // intake ≈ 2195 kcal); only the logged intake's agreement with it varies.
  it("caps at medium when the logged intake disagrees with the weight-implied intake", () => {
    const { evaluation, diagnostics } = evaluate(
      input({ weightSeries: weightSeries(-0.55), daysOnTarget: 30, loggedIntake: 2450 }),
    );
    expect(diagnostics.loggedIntake).toBe(2450);
    expect(diagnostics.intakeGap).toBe(diagnostics.estimatedIntake - 2450);
    expect(Math.abs(diagnostics.intakeGap!)).toBeGreaterThanOrEqual(200);
    expect(evaluation.confidence).toBe("medium");
  });

  it("stays high when the logged intake agrees with the weight-implied intake", () => {
    const { evaluation } = evaluate(
      input({ weightSeries: weightSeries(-0.55), daysOnTarget: 30, loggedIntake: 2195 }),
    );
    expect(evaluation.confidence).toBe("high");
  });

  it("has no effect when too few days are logged (null gap)", () => {
    const { evaluation, diagnostics } = evaluate(
      input({ weightSeries: weightSeries(-0.55), daysOnTarget: 30 }),
    );
    expect(diagnostics.loggedIntake).toBeNull();
    expect(diagnostics.intakeGap).toBeNull();
    expect(evaluation.confidence).toBe("high");
  });
});

describe("tdeeCalibration — inform-only cross-check", () => {
  const base = {
    assumedTdee: 2250,
    estimatedTdee: 2800,
    loggedIntake: 2300,
    observedRate: -0.5, // impliedFromLog = 2300 + 0.5*1100 = 2850
    weightTrustworthy: true,
  };

  it("claims 'under' when BOTH sources agree the assumed TDEE is too low (the #5 case)", () => {
    // dHealth = 2800−2250 = +550; dLog = 2850−2250 = +600 → both clear, agree.
    const c = tdeeCalibration(base)!;
    expect(c.status).toBe("under");
    expect(c.measuredLogTdee).toBe(2850);
    // Conservative: the SMALLER-magnitude of the two deltas, never the rosier one.
    expect(c.delta).toBe(550);
  });

  it("claims 'over' when both sources agree the assumed TDEE is too high", () => {
    // assumed 2800; health 2450 (−350); log: 2000 + 0.3*1100 = 2330 → −470.
    const c = tdeeCalibration({
      assumedTdee: 2800,
      estimatedTdee: 2450,
      loggedIntake: 2000,
      observedRate: -0.3,
      weightTrustworthy: true,
    })!;
    expect(c.status).toBe("over");
    expect(c.delta).toBe(-350);
  });

  it("stays 'aligned' when both deltas are within the bar", () => {
    // assumed 2800; health 2750 (−50); log 2200 + 550 = 2750 (−50).
    const c = tdeeCalibration({
      assumedTdee: 2800,
      estimatedTdee: 2750,
      loggedIntake: 2200,
      observedRate: -0.5,
      weightTrustworthy: true,
    })!;
    expect(c.status).toBe("aligned");
    expect(c.delta).toBe(0);
  });

  it("stays 'unclear' when only one source crosses the bar", () => {
    // health clears (+300) but log doesn't (−90) → no corroboration.
    const c = tdeeCalibration({
      assumedTdee: 2700,
      estimatedTdee: 3000,
      loggedIntake: 2500,
      observedRate: -0.1,
      weightTrustworthy: true,
    })!;
    expect(c.status).toBe("unclear");
    expect(c.delta).toBe(0);
  });

  it("stays 'unclear' when both cross but disagree in direction", () => {
    // health +300, log −380 → both clear, opposite signs → no claim.
    const c = tdeeCalibration({
      assumedTdee: 2600,
      estimatedTdee: 2900,
      loggedIntake: 2000,
      observedRate: -0.2,
      weightTrustworthy: true,
    })!;
    expect(c.status).toBe("unclear");
    expect(c.delta).toBe(0);
  });

  it("returns null with no food-log signal (single source can't corroborate)", () => {
    expect(tdeeCalibration({ ...base, loggedIntake: null })).toBeNull();
  });

  it("returns null when the weight trend isn't trustworthy enough to imply a TDEE", () => {
    expect(tdeeCalibration({ ...base, weightTrustworthy: false })).toBeNull();
  });
});
