import { describe, it, expect } from "vitest";
import { recoveryProvider } from "./recovery";
import { deriveRecommendations, topRecommendation } from "./index";
import type { RecContext } from "./types";
import type { RecoveryEvaluation } from "@features/health/math";
import type { NutritionEvaluation, NutritionDiagnostics } from "@features/nutrition/evaluation";

const recovery = (over: Partial<RecoveryEvaluation> = {}): RecoveryEvaluation => ({
  status: "Needs Recovery",
  score: 0,
  trainingLoad: null,
  ...over,
});

// A high-confidence nutrition "slowed" decision — the strongest thing recovery
// has to outrank (priority 72).
function nutritionCtx(): RecContext["nutrition"] {
  const evaluation: NutritionEvaluation = {
    status: "below_target",
    observedRate: -0.3,
    targetRange: { min: 0.4, max: 0.7 },
    confidence: "high",
    evaluatedAt: "2026-07-01T00:00:00.000Z",
  };
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: 2800,
    estimatedIntake: 2400,
    intakeDifference: 255,
    calorieTarget: 2145,
    cutMode: "Moderate Cut",
    windowDays: 21,
    weightDataPoints: 21,
    longestGap: 1,
    loggedIntake: null,
    intakeGap: null,
    daysOnTarget: 30,
  };
  return { evaluation, diagnostics };
}

describe("recoveryProvider — fires only on a settled dip", () => {
  it("returns null with no recovery input", () => {
    expect(recoveryProvider({})).toBeNull();
  });

  it("stays silent above 'Needs Recovery' (a recommendation is an intervention, not commentary)", () => {
    for (const status of ["Ready", "Good", "Fair"] as const) {
      expect(recoveryProvider({ recovery: recovery({ status, score: 2 }) })).toBeNull();
    }
  });

  it("frames the action by recent training load", () => {
    expect(recoveryProvider({ recovery: recovery({ trainingLoad: "trained" }) })!.subtitle)
      .toMatch(/ease today's session/i);
    expect(recoveryProvider({ recovery: recovery({ trainingLoad: "rested" }) })!.subtitle)
      .toMatch(/protect sleep/i);
    expect(recoveryProvider({ recovery: recovery({ trainingLoad: null }) })!.subtitle)
      .toMatch(/keep today easy/i);
  });

  it("routes to Health and outranks a nutrition target tweak", () => {
    const rec = recoveryProvider({ recovery: recovery({ trainingLoad: "trained" }) })!;
    expect(rec.source).toBe("recovery");
    expect(rec.priority).toBe(75);
    expect(rec.priority).toBeGreaterThan(72);
  });
});

describe("registry arbitration", () => {
  it("a settled recovery dip wins over a high-confidence nutrition adjustment", () => {
    const ctx: RecContext = {
      nutrition: nutritionCtx(),
      recovery: recovery({ trainingLoad: "trained" }),
    };
    expect(deriveRecommendations(ctx).map((r) => r.source)).toEqual(["recovery", "nutrition"]);
    expect(topRecommendation(ctx)?.source).toBe("recovery");
  });

  it("nutrition still surfaces when recovery is fine", () => {
    const ctx: RecContext = { nutrition: nutritionCtx(), recovery: recovery({ status: "Good", score: 2 }) };
    expect(topRecommendation(ctx)?.source).toBe("nutrition");
  });
});
