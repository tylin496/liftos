import { describe, it, expect } from "vitest";
import { nutritionDecision, paceLabel } from "./recommendation";
import type { NutritionEvaluation, NutritionDiagnostics, EvalStatus, Confidence } from "./evaluation";

function make(status: EvalStatus, confidence: Confidence, calorieTarget = 2145) {
  const evaluation: NutritionEvaluation = {
    status,
    observedRate: -0.07,
    targetRange: { min: 0.4, max: 0.7 },
    phaseKind: "cut",
    confidence,
    evaluatedAt: "2026-07-01T00:00:00.000Z",
    accelDirection: null,
  };
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: 2740,
    estimatedIntake: 2396,
    intakeDifference: 251,
    calorieTarget,
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

describe("nutritionDecision", () => {
  it("proposes a reduce with the new target at high confidence + below_target", () => {
    const { evaluation, diagnostics } = make("below_target", "high");
    const d = nutritionDecision(evaluation, diagnostics);
    expect(d.action).toBe("reduce");
    // Shortfall 0.4−0.07 = 0.33 kg/wk ≈ 363 kcal/day → step clamps at 150.
    expect(d.proposedTarget).toBe(1995);
    expect(d.actionHeadline).toBe("Reduce calorie target");
    expect(d.eventType).toBe("Review calorie target");
    expect(d.actionLine).toBe("Weight loss has slowed");
    expect(d.currentTarget).toBe(2145);
  });

  it("does NOT reduce when merely at the band floor and slowing (that's not a stall)", () => {
    // Being at the low edge is often the safest pace — only a genuine below-band
    // read proposes a cut. on_target + decelerating must still maintain.
    const { evaluation, diagnostics } = make("on_target", "high");
    evaluation.observedRate = -0.42; // low edge of [0.4, 0.7]
    evaluation.accelDirection = "slowing";
    const d = nutritionDecision(evaluation, diagnostics);
    expect(d.action).toBe("maintain");
  });

  it("maintains (no proposed target) with a confidence-limited reason at medium", () => {
    const { evaluation, diagnostics } = make("below_target", "medium");
    const d = nutritionDecision(evaluation, diagnostics);
    expect(d.action).toBe("maintain");
    expect(d.proposedTarget).toBeNull();
    expect(d.actionHeadline).toBe("Maintain current target");
    expect(d.reason).toMatch(/confidence is not yet high enough/i);
  });

  it("proposes an increase when losing too fast at high confidence", () => {
    const { evaluation, diagnostics } = make("above_target", "high");
    evaluation.observedRate = -0.85; // 0.15 over the 0.7 ceiling ≈ 165 kcal → clamps at 150
    const d = nutritionDecision(evaluation, diagnostics);
    expect(d.action).toBe("increase");
    expect(d.proposedTarget).toBe(2295);
  });

  it("sizes the step to the gap — a hair-thin shortfall proposes the 50 floor, not 150", () => {
    const { evaluation, diagnostics } = make("below_target", "high");
    evaluation.observedRate = -0.56; // 0.04 under a 0.6 floor ≈ 44 kcal/day
    evaluation.targetRange = { min: 0.6, max: 0.9 };
    const d = nutritionDecision(evaluation, diagnostics);
    expect(d.action).toBe("reduce");
    expect(d.proposedTarget).toBe(2095); // 2145 − 50
  });

  describe("lean bulk — the levers mirror", () => {
    const bulk = (status: EvalStatus, confidence: Confidence) => {
      const { evaluation, diagnostics } = make(status, confidence, 2955);
      evaluation.phaseKind = "bulk";
      evaluation.observedRate = 0.2;
      evaluation.targetRange = { min: 0.1, max: 0.3 };
      diagnostics.cutMode = "Lean Bulk";
      return { evaluation, diagnostics };
    };

    it("proposes an INCREASE when gaining too slowly (below_target)", () => {
      const { evaluation, diagnostics } = bulk("below_target", "high");
      evaluation.observedRate = 0.05; // 0.05 under the 0.1 floor ≈ 55 kcal → step 60
      const d = nutritionDecision(evaluation, diagnostics);
      expect(d.action).toBe("increase");
      expect(d.proposedTarget).toBe(3015); // 2955 + 60
      expect(d.actionLine).toBe("Weight gain has stalled");
    });

    it("proposes a REDUCE when gaining too fast (above_target)", () => {
      const { evaluation, diagnostics } = bulk("above_target", "high");
      evaluation.observedRate = 0.44; // 0.14 over the 0.3 ceiling ≈ 154 kcal → clamps at 150
      const d = nutritionDecision(evaluation, diagnostics);
      expect(d.action).toBe("reduce");
      expect(d.proposedTarget).toBe(2805); // 2955 − 150
      expect(d.reason).toMatch(/keep the gain lean/i);
    });

    it("LOSING during a bulk measures the shortfall from the floor, not |rate|", () => {
      const { evaluation, diagnostics } = bulk("below_target", "high");
      evaluation.observedRate = -0.05; // 0.15 under the 0.1 floor ≈ 165 kcal → clamps at 150
      const d = nutritionDecision(evaluation, diagnostics);
      expect(d.action).toBe("increase");
      expect(d.proposedTarget).toBe(3105); // 2955 + 150
    });

    it("on_target reads as gain on plan", () => {
      const { evaluation, diagnostics } = bulk("on_target", "high");
      expect(nutritionDecision(evaluation, diagnostics).actionLine).toBe("Weight gain remains on plan");
    });

    it("medium confidence holds with gain-framed copy", () => {
      const { evaluation, diagnostics } = bulk("below_target", "medium");
      const d = nutritionDecision(evaluation, diagnostics);
      expect(d.action).toBe("maintain");
      expect(d.actionLine).toMatch(/gain looks slow/i);
    });
  });
});

describe("paceLabel", () => {
  it("maps status to a one-word pace read", () => {
    expect(paceLabel(make("on_target", "high").evaluation)).toBe("On pace");
    expect(paceLabel(make("below_target", "high").evaluation)).toBe("Below pace");
    expect(paceLabel(make("above_target", "high").evaluation)).toBe("Too fast");
    expect(paceLabel(make("below_target", "low").evaluation)).toBe("Calibrating");
  });

  it("stays 'On pace' at the band floor while slowing (deceleration lives on the accel arrow)", () => {
    const e = make("on_target", "high").evaluation;
    e.observedRate = -0.42; // low edge of [0.4, 0.7]
    e.accelDirection = "slowing";
    expect(paceLabel(e)).toBe("On pace");
  });
});
