import { describe, it, expect } from "vitest";
import { nutritionDecision, paceLabel } from "./recommendation";
import type { NutritionEvaluation, NutritionDiagnostics, EvalStatus, Confidence } from "./evaluation";

function make(status: EvalStatus, confidence: Confidence, calorieTarget = 2145) {
  const evaluation: NutritionEvaluation = {
    status,
    observedRate: -0.07,
    targetRange: { min: 0.4, max: 0.7 },
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
    expect(d.proposedTarget).toBe(1995); // 2145 − CUT_STEP(150)
    expect(d.actionHeadline).toBe("Reduce calorie target");
    expect(d.eventType).toBe("Review calorie target");
    expect(d.actionLine).toBe("Weight loss has slowed");
    expect(d.currentTarget).toBe(2145);
  });

  it("proposes a reduce when at the band floor AND slowing (still technically in-band)", () => {
    const { evaluation, diagnostics } = make("on_target", "high");
    // loss 0.42 is in the bottom slice of [0.4, 0.7] (floor..0.46) and decelerating.
    evaluation.observedRate = -0.42;
    evaluation.accelDirection = "slowing";
    const d = nutritionDecision(evaluation, diagnostics);
    expect(d.action).toBe("reduce");
    expect(d.proposedTarget).toBe(1995);
    expect(d.actionLine).toMatch(/low edge/i);
  });

  it("does NOT reduce at the floor when the rate is not slowing", () => {
    const { evaluation, diagnostics } = make("on_target", "high");
    evaluation.observedRate = -0.42;
    evaluation.accelDirection = null; // flat, not decelerating
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
    const d = nutritionDecision(evaluation, diagnostics);
    expect(d.action).toBe("increase");
    expect(d.proposedTarget).toBe(2295);
  });
});

describe("paceLabel", () => {
  it("maps status to a one-word pace read", () => {
    expect(paceLabel(make("on_target", "high").evaluation)).toBe("On pace");
    expect(paceLabel(make("below_target", "high").evaluation)).toBe("Below pace");
    expect(paceLabel(make("above_target", "high").evaluation)).toBe("Too fast");
    expect(paceLabel(make("below_target", "low").evaluation)).toBe("Calibrating");
  });

  it("reads 'Easing' at the band floor while slowing (not a flat 'On pace')", () => {
    const e = make("on_target", "high").evaluation;
    e.observedRate = -0.42; // bottom slice of [0.4, 0.7]
    e.accelDirection = "slowing";
    expect(paceLabel(e)).toBe("Easing");
  });
});
