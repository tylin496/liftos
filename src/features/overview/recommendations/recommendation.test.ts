import { describe, it, expect } from "vitest";
import { nutritionProvider } from "./nutrition";
import { deriveRecommendations, topRecommendation } from "./index";
import type { RecContext } from "./types";
import type { NutritionEvaluation, NutritionDiagnostics, EvalStatus, Confidence } from "@features/nutrition/evaluation";

function ctx(status: EvalStatus, confidence: Confidence, calorieTarget = 2145): RecContext {
  const evaluation: NutritionEvaluation = {
    status,
    observedRate: -0.3,
    targetRange: { min: 0.4, max: 0.7 },
    confidence,
    evaluatedAt: "2026-07-01T00:00:00.000Z",
  };
  const diagnostics: NutritionDiagnostics = {
    estimatedTdee: 2800,
    estimatedIntake: 2400,
    intakeDifference: 255,
    calorieTarget,
    cutMode: "Moderate Cut",
    windowDays: 21,
    weightDataPoints: 21,
  };
  return { nutrition: { evaluation, diagnostics } };
}

describe("nutritionProvider — event type + specific action", () => {
  it("flags an adjustment (event type) with the cut as the action at high confidence", () => {
    const rec = nutritionProvider(ctx("below_target", "high"))!;
    expect(rec.title).toBe("Nutrition adjustment recommended");
    expect(rec.subtitle).toMatch(/reduce target to 2,045 kcal/i);
    expect(rec.priority).toBe(72);
  });

  it("stays on-track and holds at medium confidence", () => {
    const rec = nutritionProvider(ctx("below_target", "medium"))!;
    expect(rec.title).toBe("Nutrition on track");
    expect(rec.subtitle).toMatch(/^hold 2,145 kcal/i);
    expect(rec.priority).toBe(55);
  });

  it("flags an adjustment with the raise as the action when losing too fast", () => {
    const rec = nutritionProvider(ctx("above_target", "high"))!;
    expect(rec.title).toBe("Nutrition adjustment recommended");
    expect(rec.subtitle).toMatch(/increase target to 2,295 kcal/i);
    expect(rec.priority).toBe(70);
  });

  it("is on track when on target", () => {
    const rec = nutritionProvider(ctx("on_target", "high"))!;
    expect(rec.title).toBe("Nutrition on track");
    expect(rec.subtitle).toMatch(/maintain 2,145 kcal/i);
    expect(rec.priority).toBe(30);
  });

  it("never proposes a change at low confidence", () => {
    const rec = nutritionProvider(ctx("below_target", "low"))!;
    expect(rec.title).toBe("Nutrition on track");
    expect(rec.subtitle).toMatch(/gathering data/i);
    expect(rec.priority).toBe(40);
  });

  it("returns null with no nutrition input", () => {
    expect(nutritionProvider({})).toBeNull();
  });
});

describe("registry", () => {
  it("sorts by priority desc and topRecommendation takes the most urgent", () => {
    const recs = deriveRecommendations(ctx("below_target", "high"));
    expect(recs.length).toBe(1);
    expect(topRecommendation(ctx("below_target", "high"))?.priority).toBe(72);
  });

  it("yields no recommendations when every provider abstains", () => {
    expect(deriveRecommendations({})).toEqual([]);
    expect(topRecommendation({})).toBeNull();
  });
});
